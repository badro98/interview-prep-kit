// Minimal local proxy for API mode.
//
// Paste mode needs none of this. Run with `npm run dev:api` (vite + this together).
// Vite proxies /api -> http://localhost:3001 (see vite.config.js).

import "dotenv/config";
import express from "express";
import multer from "multer";
import { generateText, generateChat, scoreAudio, isConfigured, MODEL } from "./gemini.js";
import { fetchPublicUrl } from "./fetchUrl.js";
import { transcribeInterview, assemblyConfigured } from "./transcribe.js";
import { createJob, getJob, patchJob, publicJobView, cancelJob } from "./transcribeJobs.js";

const app = express();

// Dev: browser uploads go directly to :3001 (bypasses Vite proxy buffering on large files).
const DEV_ORIGINS = [5173, 5174, 5175, 5176].map((p) => `http://localhost:${p}`);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && DEV_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// WAV audio is sent as base64, so allow a generous body size.
app.use(express.json({ limit: "30mb" }));

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB — Voice Memos can be ~200MB at 45 min

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "gemini",
    model: MODEL,
    configured: isConfigured(),
    assemblyai: assemblyConfigured(),
  });
});

// Text coaching (API mode for prep-docs / flashcards). coach() posts { system, messages }.
app.post("/api/chat", async (req, res) => {
  try {
    const { system, messages } = req.body || {};
    const list = Array.isArray(messages) ? messages : [];
    const text =
      list.length > 0 && list.some((m) => m.role)
        ? await generateChat({ system, messages: list })
        : await generateText({
            system,
            user: list.map((m) => m.content).join("\n\n") || String(messages || ""),
          });
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message, cause: e.cause?.message || undefined });
  }
});

// Audio scoring (tone + content). Browser sends base64 WAV + the assembled prompt.
app.post("/api/score-audio", async (req, res) => {
  try {
    const { prompt, audioBase64, mimeType } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: "Missing audio data." });
    const text = await scoreAudio({ prompt, audioBase64, mimeType });
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message, cause: e.cause?.message || undefined });
  }
});

// Fetch a public webpage for advisor context ingestion.
app.post("/api/fetch-url", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url." });
    const data = await fetchPublicUrl(url);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Interview recording transcription — returns job id immediately, poll for progress.
app.post("/api/transcribe-interview", (req, res) => {
  const mb = req.headers["content-length"]
    ? `${(Number(req.headers["content-length"]) / (1024 * 1024)).toFixed(1)} MB`
    : "unknown size";
  console.log(`transcribe upload receiving (${mb})…`);

  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `Recording exceeds ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB. Compress with ffmpeg and re-upload.`,
        });
      }
      return res.status(400).json({ error: err.message || "Upload failed." });
    }

    const { stageId, context: contextBlock } = req.body || {};
    const file = req.file;
    if (!stageId) return res.status(400).json({ error: "Missing stageId." });
    if (!file?.buffer?.length) return res.status(400).json({ error: "Missing audio file." });

    const jobId = createJob();
    patchJob(jobId, { status: "running", phase: "Upload complete", progress: 5 });

    console.log(
      `transcribe job ${jobId} ${stageId}: ${file.originalname} (${(file.buffer.length / (1024 * 1024)).toFixed(1)} MB)`
    );

    res.json({ jobId });

    transcribeInterview({
      buffer: file.buffer,
      mimeType: file.mimetype || "audio/mp4",
      fileName: file.originalname,
      stageId,
      contextBlock,
      onProgress: ({ phase, progress }) => {
        patchJob(jobId, { phase, progress, status: "running" });
      },
      onPartial: (partial) => {
        patchJob(jobId, {
          partialResult: partial,
          phase: "Transcript ready — finishing summary",
          progress: 76,
          status: "running",
        });
      },
    })
      .then((result) => {
        patchJob(jobId, {
          status: "done",
          phase: "Done",
          progress: 100,
          result,
          partialResult: null,
        });
        console.log(`transcribe job ${jobId} done`);
      })
      .catch((e) => {
        console.error(`transcribe job ${jobId} error:`, e.message);
        patchJob(jobId, { status: "error", phase: "Failed", error: e.message });
      });
  });
});

app.get("/api/transcribe-jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(publicJobView(job));
});

app.delete("/api/transcribe-jobs/:jobId", (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json({ ok: true });
});

// Multer / upload errors that slip past route handlers.
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: `Recording exceeds ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB. Compress the file and try again.`,
    });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(
    `proxy on :${PORT} — gemini ${MODEL}, key ${isConfigured() ? "set ✓" : "MISSING ✗"}, assemblyai ${assemblyConfigured() ? "set ✓" : "off"}`
  );
});
