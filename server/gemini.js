// Gemini client + helpers. The API key stays here (server-side), never in the browser.
//
// Gemini takes audio natively, so it can judge vocal DELIVERY (pace, pauses, fillers,
// confidence, tone) on top of content — which a transcript-only model can't.

import { GoogleGenAI, createPartFromUri, FileState } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let client = null;
function ai() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env (see .env.example) and restart with `npm run dev`."
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function formatGroundingSources(res) {
  const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return "";

  const seen = new Set();
  const lines = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    let host = "";
    try {
      host = new URL(uri).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    if (host && seen.has(`host:${host}`)) continue;
    if (host) seen.add(`host:${host}`);
    lines.push(`- [${title}](${uri})`);
  }
  if (lines.length === 0) return "";
  return `\n\n**Sources:**\n${lines.join("\n")}`;
}

async function generateChatOnce({ system, messages, webSearch }) {
  const contents = (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const config = {};
  if (system) config.systemInstruction = system;
  if (webSearch) config.tools = [{ googleSearch: {} }];

  const res = await ai().models.generateContent({
    model: MODEL,
    contents,
    ...(Object.keys(config).length ? { config } : {}),
  });
  const text = res.text || "";
  return webSearch ? text + formatGroundingSources(res) : text;
}

/** Multi-turn chat (advisor + any feature that sends role-tagged messages). */
export async function generateChat({ system, messages, webSearch = false }) {
  try {
    return await generateChatOnce({ system, messages, webSearch });
  } catch (e) {
    // Some models/configs reject googleSearch — retry without tools.
    if (webSearch) {
      console.warn("generateChat with webSearch failed; retrying without tools:", e.message);
      return generateChatOnce({ system, messages, webSearch: false });
    }
    throw e;
  }
}

/** Single-turn text (legacy coaching calls). */
export async function generateText({ system, user }) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: user }] }],
    ...(system ? { config: { systemInstruction: system } } : {}),
  });
  return res.text;
}

/** Audio-native scoring: the model listens to the recording and judges tone + content. */
export async function scoreAudio({ prompt, audioBase64, mimeType = "audio/wav" }) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      },
    ],
  });
  return res.text;
}

/** PDF → clean markdown (resume/profile intake). Gemini reads PDFs natively. */
export async function pdfToMarkdown(pdfBase64) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Convert this document to clean markdown. Preserve headings, lists, and structure. " +
              "Output only the markdown — no commentary, no code fences.",
          },
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
        ],
      },
    ],
  });
  return res.text;
}

const INLINE_AUDIO_LIMIT = 20 * 1024 * 1024; // 20MB

function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1].trim() : trimmed;

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(raw);
  if (parsed) return parsed;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    parsed = tryParse(raw.slice(start, end + 1));
    if (parsed) return parsed;
  }

  // Last resort: salvage a truncated speakers array from partial JSON.
  const speakersMatch = raw.match(/"speakers"\s*:\s*\[[\s\S]*/);
  if (speakersMatch) {
    let chunk = speakersMatch[0];
    if (!chunk.endsWith("]")) {
      const lastObj = chunk.lastIndexOf("}");
      if (lastObj > 0) chunk = chunk.slice(0, lastObj + 1) + "]";
    }
    parsed = tryParse(`{${chunk}}`);
    if (parsed?.speakers) return parsed;
  }

  throw new Error("Model returned invalid JSON (truncated or malformed).");
}

async function waitForFileActive(uploaded) {
  let file = uploaded;
  const maxWait = 5 * 60 * 1000;
  const started = Date.now();
  while (file.state === FileState.PROCESSING && Date.now() - started < maxWait) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai().files.get({ name: file.name });
  }
  if (file.state !== FileState.ACTIVE) {
    throw new Error(file.error?.message || "Gemini file processing failed.");
  }
  return file;
}

async function audioPartFromBuffer(buffer, mimeType) {
  if (buffer.length <= INLINE_AUDIO_LIMIT) {
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  }
  const blob = new Blob([buffer], { type: mimeType });
  const uploaded = await ai().files.upload({
    file: blob,
    config: { mimeType },
  });
  const ready = await waitForFileActive(uploaded);
  return createPartFromUri(ready.uri, ready.mimeType || mimeType);
}

/** Gemini fallback: diarized transcription from audio buffer (short clips only). */
export async function transcribeAudioWithDiarization({ buffer, mimeType, prompt }) {
  const audioPart = await audioPartFromBuffer(buffer, mimeType);
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, audioPart],
      },
    ],
    config: { responseMimeType: "application/json" },
  });
  let parsed;
  try {
    parsed = parseJsonResponse(res.text);
  } catch (e) {
    throw new Error(
      `Gemini transcription returned invalid JSON. Use AssemblyAI for long recordings. (${e.message})`
    );
  }
  const speakers = (parsed.speakers || []).map((s) => ({
    id: String(s.id),
    label: s.label || `Speaker ${s.id}`,
  }));
  const segments = (parsed.segments || []).map((seg) => ({
    speaker: String(seg.speaker),
    startMs: Number(seg.startMs) || 0,
    endMs: Number(seg.endMs) || 0,
    text: String(seg.text || ""),
  }));
  const durationMs =
    Number(parsed.durationMs) ||
    segments.at(-1)?.endMs ||
    0;
  return { segments, speakers, durationMs, provider: "gemini" };
}

/** Map generic speaker labels to You / Interviewer. Never throws — returns null on failure. */
export async function mapSpeakers({ prompt }) {
  try {
    const res = await ai().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const parsed = parseJsonResponse(res.text);
    const speakers = (parsed.speakers || []).map((s) => ({
      id: String(s.id),
      label: s.label || `Speaker ${s.id}`,
    }));
    return speakers.length ? speakers : null;
  } catch (e) {
    console.warn("mapSpeakers failed:", e.message);
    return null;
  }
}

/** Stage-aware debrief summary from diarized transcript. */
export async function summarizeInterview({ prompt }) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return res.text;
}
