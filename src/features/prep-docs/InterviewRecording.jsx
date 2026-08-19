import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import {
  getRecordingByStage,
  replaceRecordingForStage,
  updateRecording,
  deleteRecording,
} from "../../lib/db.js";
import { setRecordingFlag, addCustomContextEntry } from "../../lib/store.js";
import { getActiveJobId } from "../../lib/jobs.js";
import {
  transcribeInterview,
  getTranscribeStatus,
  estimateUploadMinutes,
  pollTranscribeJob,
  fetchTranscribeJob,
  cancelTranscribeJob,
  progressStepLabel,
  isTranscribeCancelled,
  ASSEMBLYAI_REQUIRED_BYTES,
} from "../../lib/transcribe.js";
import {
  transcriptToTxt,
  transcriptToMd,
  transcriptToJson,
} from "../../lib/transcribePrompt.js";
import { getStageDoc } from "./stages.js";

const ACCEPTED_TYPES = [
  { ext: ".m4a", note: "iPhone Voice Memos" },
  { ext: ".mp3", note: "MP3" },
  { ext: ".wav", note: "WAV" },
  { ext: ".mp4", note: "MP4 audio" },
  { ext: ".aac", note: "AAC" },
];
const TEXT_TYPES = [
  { ext: ".txt", note: "plain transcript" },
  { ext: ".md", note: "markdown notes" },
];
const ACCEPT_ATTR = ACCEPTED_TYPES.map((t) => t.ext).join(",") + ",audio/*";
const ACCEPT_TEXT_ATTR = TEXT_TYPES.map((t) => t.ext).join(",") + ",text/plain,text/markdown";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;

function isTextFile(file) {
  const name = (file?.name || "").toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    (file?.type || "").startsWith("text/")
  );
}

function segmentsFromPlainText(text) {
  const cleaned = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  // Keep as one segment so pasted/uploaded transcripts stay readable as-is.
  return [{ speaker: "Transcript", startMs: 0, endMs: 0, text: cleaned }];
}

function recordingToContextMarkdown(recording, stageTitle) {
  const title = stageTitle || "Interview";
  const transcript = transcriptToTxt(recording);
  if (recording?.summary?.trim() && recording.summary.trim() !== transcript.trim()) {
    return `# ${title} — debrief\n\n${recording.summary.trim()}\n\n---\n\n## Transcript\n\n${transcript}`;
  }
  if (recording?.summary?.trim() && !transcript.trim()) {
    return `# ${title} — transcript\n\n${recording.summary.trim()}`;
  }
  return `# ${title} — transcript\n\n${transcript}`;
}

function fmtFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function assertUploadSize(bytes) {
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${fmtFileSize(bytes)} (limit ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB). Compress with ffmpeg, delete this recording, and re-upload the smaller file.`
    );
  }
}

function assertCanTranscribe(fileBytes, proxy) {
  assertUploadSize(fileBytes);
  if (fileBytes > ASSEMBLYAI_REQUIRED_BYTES && !proxy.assemblyai) {
    throw new Error(
      `File is ${fmtFileSize(fileBytes)} — recordings over 25MB need AssemblyAI. Add ASSEMBLYAI_API_KEY to .env and restart \`npm run dev\` (terminal must show assemblyai set ✓).`
    );
  }
}

function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtTimestamp(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AudioPlayback({ blob, type }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  if (!url) return null;
  return <audio controls src={url} className="w-full" />;
}

const PROGRESS_STEPS = [
  { id: "upload", label: "Upload", steps: ["saving", "uploading", "processing"] },
  { id: "transcribe", label: "Transcribe", steps: ["transcribing"] },
  { id: "summary", label: "Summary", steps: ["summarizing"] },
];

function stepGroupIndex(step) {
  const idx = PROGRESS_STEPS.findIndex((g) => g.steps.includes(step));
  return idx >= 0 ? idx : 0;
}

function TranscribeProgress({ jobProgress, onCancel }) {
  const step = jobProgress?.step || "uploading";
  const pct = Math.min(100, Math.max(0, jobProgress?.progress || 0));
  const activeGroup = stepGroupIndex(step);
  const transcriptReady = step === "summarizing" || (pct >= 82 && pct < 100);

  return (
    <div className="w-full rounded-lg border border-line bg-surface/40 p-4">
      <div className="mb-4 flex items-center gap-2">
        {PROGRESS_STEPS.map((group, i) => {
          const done = i < activeGroup || step === "done";
          const active = i === activeGroup && step !== "done";
          return (
            <div key={group.id} className="flex min-w-0 flex-1 items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px flex-1 ${done ? "bg-accent/60" : "bg-surface2"}`}
                />
              )}
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                    done
                      ? "bg-accent text-white"
                      : active
                        ? "border border-accent bg-accent/20 text-accent"
                        : "border border-line text-ink2"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    active ? "text-ink1" : done ? "text-ink2" : "text-ink2"
                  }`}
                >
                  {group.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-ink1">
          {jobProgress?.label || "Processing…"}
        </span>
        <span className="tabular-nums text-ink2">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
        <div
          className={`h-full rounded-full bg-accent transition-[width] duration-700 ease-out ${
            step === "processing" ? "animate-pulse" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {jobProgress?.detail && (
        <p className="mt-2 text-[11px] text-ink2">{jobProgress.detail}</p>
      )}
      <p className="mt-2 text-[11px] text-ink2">
        {step === "uploading"
          ? "Upload progress tracks MB sent from your browser. Large .m4a files are slow — mono .mp3 (~64kbps) is ~3× faster."
          : step === "processing"
            ? "Your browser finished sending the file. The server is receiving and queueing it — this can take a minute for large files."
            : transcriptReady
              ? "Transcript is ready below — summary and speaker labels still generating."
              : step === "transcribing"
                ? "AssemblyAI is transcribing with speaker diarization. You can leave this tab open."
                : null}
      </p>
      {onCancel && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink1 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

async function applyPartialTranscript(recordingId, partial, extra = {}) {
  const patch = {
    segments: partial.segments || [],
    speakers: partial.speakers || [],
    provider: partial.provider,
    durationMs: partial.durationMs,
    status: "processing",
    ...extra,
  };
  await updateRecording(recordingId, patch);
  return patch;
}

export default function InterviewRecording({ stageId, onChange }) {
  const stage = useMemo(() => getStageDoc(stageId), [stageId]);
  const [recording, setRecording] = useState(null);
  const [hydrating, setHydrating] = useState(true);
  const [busy, setBusy] = useState(false);
  const [jobProgress, setJobProgress] = useState(null);
  const [err, setErr] = useState("");
  const [proxy, setProxy] = useState({ reachable: false, configured: false, assemblyai: false });
  const [intakeMode, setIntakeMode] = useState("audio"); // audio | text
  const [pasteText, setPasteText] = useState("");
  const [contextSavedName, setContextSavedName] = useState("");
  const sessionRef = useRef(null);

  function beginSession() {
    sessionRef.current?.abort();
    const ac = new AbortController();
    sessionRef.current = ac;
    return ac.signal;
  }

  function abortSession() {
    sessionRef.current?.abort();
    sessionRef.current = null;
  }

  async function resetToUploaded(recordingId) {
    if (!recordingId) return;
    const next = await updateRecording(recordingId, {
      status: "uploaded",
      transcribeJobId: null,
      error: null,
    });
    if (next) setRecording(next);
  }

  // `ownerJobId` is the active-job id captured when the triggering flow
  // (upload/retranscribe/resume) started. updateRecording is keyed by the
  // recording's own id, so it's safe to run unconditionally even if the user
  // has since switched jobs. setRecordingFlag, though, resolves against
  // whatever job is ACTIVE at call time — if that's no longer the job this
  // recording belongs to (e.g. the user opened the add-job wizard mid-upload),
  // writing it would flip the flag under the wrong job. Guard it.
  async function finalizeTranscription(recordingId, result, durationFallback, ownerJobId) {
    const done = await updateRecording(recordingId, {
      status: "done",
      segments: result.segments,
      speakers: result.speakers,
      summary: result.summary,
      durationMs: result.durationMs || durationFallback,
      provider: result.provider,
      transcribeJobId: null,
      error: null,
    });
    setRecording(done);
    if (ownerJobId === getActiveJobId()) setRecordingFlag(stageId, true);
    onChange?.();
    return done;
  }

  function pollCallbacks(recordingId) {
    return {
      onProgress: (update) => setJobProgress(update),
      onPartial: async (partial) => {
        const patch = await applyPartialTranscript(recordingId, partial);
        setRecording((prev) => ({ ...prev, ...patch }));
      },
    };
  }

  async function pollExistingJob(transcribeJobId, recordingId, durationFallback, signal, ownerJobId) {
    setBusy(true);
    setErr("");
    try {
      const result = await pollTranscribeJob(transcribeJobId, {
        ...pollCallbacks(recordingId),
        signal,
      });
      await finalizeTranscription(recordingId, result, durationFallback, ownerJobId);
    } catch (ex) {
      if (isTranscribeCancelled(ex)) {
        await resetToUploaded(recordingId);
        return;
      }
      setErr(ex.message || "Transcription failed.");
      await updateRecording(recordingId, {
        status: "error",
        error: ex.message,
        transcribeJobId: null,
      });
      setRecording((prev) =>
        prev ? { ...prev, status: "error", error: ex.message, transcribeJobId: null } : prev
      );
    } finally {
      abortSession();
      setBusy(false);
      setJobProgress(null);
    }
  }

  async function markRecordingUploaded(rec) {
    const next = await updateRecording(rec.id, {
      status: "uploaded",
      transcribeJobId: null,
      error: null,
    });
    setRecording(next || rec);
  }

  async function recoverProcessingRecording(rec) {
    // Captured once, up front — this is the job this recording belongs to
    // for the duration of the resume flow.
    const jobId = getActiveJobId();
    const hasPartial =
      Array.isArray(rec.segments) && rec.segments.length > 0 && !rec.summary;

    if (rec.transcribeJobId) {
      const job = await fetchTranscribeJob(rec.transcribeJobId);
      if (job?.status === "done" && job.result) {
        await finalizeTranscription(rec.id, job.result, rec.durationMs, jobId);
        return;
      }
      if (job?.status === "running" || job?.status === "queued") {
        setRecording(rec);
        setJobProgress({
          step: job.partialResult ? "summarizing" : "transcribing",
          label: job.phase || "Resuming transcription…",
          progress: job.partialResult ? 85 : job.progress >= 18 ? 55 : 40,
        });
        await pollExistingJob(
          rec.transcribeJobId,
          rec.id,
          rec.durationMs,
          beginSession(),
          jobId
        );
        return;
      }
      if (job?.status === "error") {
        const next = await updateRecording(rec.id, {
          status: "error",
          error: job.error,
          transcribeJobId: null,
        });
        setRecording(next || rec);
        setErr(job.error || "Transcription failed.");
        return;
      }
      // Server restarted or job expired — audio is still in IndexedDB.
      await markRecordingUploaded(rec);
      return;
    }

    if (hasPartial) {
      await markRecordingUploaded(rec);
      setErr("Transcript saved — click Transcribe to generate the debrief summary.");
      return;
    }

    // Upload/transcription was in progress but no server job to resume.
    await markRecordingUploaded(rec);
  }

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    getRecordingByStage(stageId)
      .then(async (rec) => {
        if (cancelled) return;
        if (rec?.status === "processing") {
          await recoverProcessingRecording(rec);
        } else {
          setRecording(rec);
          setRecordingFlag(stageId, rec?.status === "done");
        }
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    getTranscribeStatus().then(setProxy);
    return () => {
      cancelled = true;
    };
  }, [stageId]);

  async function saveTextTranscript({ text, fileName }) {
    const cleaned = String(text || "").trim();
    if (!cleaned) {
      setErr("Paste or upload a non-empty transcript.");
      return;
    }
    if (cleaned.length > MAX_TEXT_CHARS) {
      setErr(`Transcript is too long (limit ${MAX_TEXT_CHARS.toLocaleString()} characters).`);
      return;
    }
    if (recording) {
      const ok = window.confirm(
        "Replace the existing recording/transcript for this stage? The previous data will be deleted."
      );
      if (!ok) return;
    }

    setErr("");
    setContextSavedName("");
    const ownerJobId = getActiveJobId();
    const segments = segmentsFromPlainText(cleaned);
    const saved = await replaceRecordingForStage(stageId, {
      fileName: fileName || "pasted-transcript.txt",
      audioBlob: null,
      audioType: "text/plain",
      durationMs: 0,
      status: "done",
      segments,
      speakers: [{ id: "Transcript", label: "Transcript" }],
      // Keep summary empty so the UI shows one Transcript panel (not a duplicate "debrief").
      summary: "",
      provider: "paste",
      transcribeJobId: null,
      error: null,
    });
    setRecording(saved);
    if (ownerJobId === getActiveJobId()) setRecordingFlag(stageId, true);
    onChange?.();
    setPasteText("");
  }

  async function handleTextFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      await saveTextTranscript({ text, fileName: file.name });
    } catch (ex) {
      setErr(ex.message || "Could not read that text file.");
    }
  }

  async function handlePasteSave() {
    await saveTextTranscript({
      text: pasteText,
      fileName: `${stage?.title || "stage"}-transcript.txt`,
    });
  }

  function handleAddToContext() {
    if (!recording || !hasTranscript) return;
    const name = `${stage?.title || "Interview"} transcript`;
    const content = recordingToContextMarkdown(recording, stage?.title);
    const entry = addCustomContextEntry({ name, content });
    setContextSavedName(entry.name);
    onChange?.();
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (isTextFile(file)) {
      try {
        const text = await file.text();
        await saveTextTranscript({ text, fileName: file.name });
      } catch (ex) {
        setErr(ex.message || "Could not read that text file.");
      }
      return;
    }

    try {
      assertCanTranscribe(file.size, proxy);
    } catch (ex) {
      setErr(ex.message);
      return;
    }

    if (recording?.status === "done") {
      const ok = window.confirm(
        "Replace the existing recording for this stage? The previous transcript will be deleted."
      );
      if (!ok) return;
    }

    setErr("");
    setBusy(true);
    setJobProgress({
      step: "saving",
      label: "Saving audio locally…",
      detail: fmtFileSize(file.size),
      progress: 2,
    });

    // Captured before the upload/transcribe flow begins — used to guard the
    // completion write against a job switch mid-flight (see finalizeTranscription).
    const ownerJobId = getActiveJobId();
    let savedId = null;
    const signal = beginSession();
    try {
      const durationMs = await readAudioDuration(file);
      const saved = await replaceRecordingForStage(stageId, {
        fileName: file.name,
        audioBlob: file,
        audioType: file.type || "audio/mp4",
        durationMs,
        status: "processing",
        processingStartedAt: Date.now(),
        transcribeJobId: null,
      });
      savedId = saved.id;
      setRecording(saved);

      const result = await transcribeInterview({
        stageId,
        file,
        signal,
        ...pollCallbacks(saved.id),
        onJobStarted: async (jobId) => {
          await updateRecording(saved.id, { transcribeJobId: jobId });
          setRecording((prev) => (prev ? { ...prev, transcribeJobId: jobId } : prev));
        },
      });

      await finalizeTranscription(saved.id, result, durationMs, ownerJobId);
    } catch (ex) {
      if (isTranscribeCancelled(ex)) {
        await resetToUploaded(savedId);
        return;
      }
      setErr(ex.message || "Transcription failed.");
      if (savedId) {
        const failed = await updateRecording(savedId, {
          status: "error",
          error: ex.message,
        });
        if (failed) setRecording(failed);
      }
    } finally {
      abortSession();
      setBusy(false);
      setJobProgress(null);
    }
  }

  async function handleCancel() {
    if (!busy) return;
    if (
      !window.confirm(
        "Cancel upload/transcription? Your audio file will be kept — you can Transcribe again later."
      )
    ) {
      return;
    }
    const recordingId = recording?.id;
    const jobId = recording?.transcribeJobId;
    abortSession();
    await cancelTranscribeJob(jobId);
    await resetToUploaded(recordingId);
    setBusy(false);
    setJobProgress(null);
    setErr("");
  }

  async function handleDelete() {
    if (!recording) return;
    if (!window.confirm("Delete this recording and transcript?")) return;
    await deleteRecording(recording.id);
    setRecording(null);
    setRecordingFlag(stageId, false);
    onChange?.();
  }

  async function handleRetranscribe() {
    if (!recording?.audioBlob) return;
    try {
      assertCanTranscribe(recording.audioBlob.size, proxy);
    } catch (ex) {
      setErr(ex.message);
      return;
    }
    if (!window.confirm("Re-run transcription on the saved audio?")) return;

    // Captured before the retranscribe flow begins — see finalizeTranscription.
    const ownerJobId = getActiveJobId();
    setErr("");
    setBusy(true);
    setJobProgress({
      step: "uploading",
      label: "Preparing to upload saved audio…",
      progress: 4,
    });

    try {
      await updateRecording(recording.id, {
        status: "processing",
        error: null,
        processingStartedAt: Date.now(),
        transcribeJobId: null,
      });
      setRecording((r) => ({ ...r, status: "processing" }));

      const file = new File([recording.audioBlob], recording.fileName, {
        type: recording.audioType,
      });
      const signal = beginSession();
      const result = await transcribeInterview({
        stageId,
        file,
        signal,
        ...pollCallbacks(recording.id),
        onJobStarted: async (jobId) => {
          await updateRecording(recording.id, { transcribeJobId: jobId });
          setRecording((prev) => (prev ? { ...prev, transcribeJobId: jobId } : prev));
        },
      });

      await finalizeTranscription(recording.id, result, recording.durationMs, ownerJobId);
    } catch (ex) {
      if (isTranscribeCancelled(ex)) {
        await resetToUploaded(recording.id);
        return;
      }
      setErr(ex.message || "Re-transcription failed.");
      await updateRecording(recording.id, { status: "error", error: ex.message });
      setRecording((r) => ({ ...r, status: "error", error: ex.message }));
    } finally {
      abortSession();
      setBusy(false);
      setJobProgress(null);
    }
  }

  function handleDownload(format) {
    if (!recording) return;
    const base = `${stageId}-interview`;
    if (format === "txt") {
      downloadBlob(
        `${base}.txt`,
        transcriptToTxt(recording),
        "text/plain"
      );
    } else if (format === "md") {
      downloadBlob(
        `${base}.md`,
        transcriptToMd({
          ...recording,
          stageTitle: stage?.title,
        }),
        "text/markdown"
      );
    } else {
      downloadBlob(
        `${base}.json`,
        transcriptToJson(recording),
        "application/json"
      );
    }
  }

  const isProcessing = busy;
  const hasTranscript =
    !!recording?.summary ||
    (Array.isArray(recording?.segments) && recording.segments.length > 0);
  const isDone = recording?.status === "done" || (hasTranscript && !busy);
  const summaryPending =
    busy && recording?.segments?.length > 0 && !recording?.summary;
  const uploadEstimateMin = recording?.audioBlob?.size
    ? estimateUploadMinutes(recording.audioBlob.size)
    : null;
  const hasSavedRecording = !!recording && !hydrating;
  const statusLabel =
    recording?.status === "error"
      ? "failed"
      : isProcessing && jobProgress?.step
        ? progressStepLabel(jobProgress.step)
        : isDone
          ? "transcribed"
          : recording?.status === "uploaded" || recording?.status === "processing"
            ? "audio only"
            : null;

  const isTextOnly = recording?.provider === "paste" || (!recording?.audioBlob && hasTranscript);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-8 py-4">
        <p className="text-sm text-ink1">
          Add an audio recording <span className="text-ink2">or</span> a text transcript for
          this stage. Optionally save it into this job&apos;s Context so Advisor
          can use it.
        </p>
        <div className="mt-3 flex gap-1 rounded-lg bg-surface p-1 text-xs w-fit">
          <button
            type="button"
            onClick={() => setIntakeMode("audio")}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              intakeMode === "audio"
                ? "bg-accent text-white"
                : "text-ink1 hover:bg-surface2"
            }`}
          >
            Audio
          </button>
          <button
            type="button"
            onClick={() => setIntakeMode("text")}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              intakeMode === "text"
                ? "bg-accent text-white"
                : "text-ink1 hover:bg-surface2"
            }`}
          >
            Text transcript
          </button>
        </div>
        {intakeMode === "audio" ? (
          <>
            <p className="mt-2 text-xs text-ink2">
              Accepted formats:{" "}
              {ACCEPTED_TYPES.map((t, i) => (
                <span key={t.ext}>
                  {i > 0 && " · "}
                  <span className="font-medium text-ink2">{t.ext}</span>
                  {t.note ? ` (${t.note})` : ""}
                </span>
              ))}
              {" · "}
              up to 45 min / 200MB
            </p>
            <p className="mt-1 text-xs text-ink2">
              Tip: export as mono <span className="font-mono text-ink2">.mp3</span> (~64kbps,
              ~20MB for 45 min) for ~3× faster uploads vs large .m4a files.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-ink2">
            Paste a transcript or upload{" "}
            {TEXT_TYPES.map((t, i) => (
              <span key={t.ext}>
                {i > 0 && " / "}
                <span className="font-mono text-ink2">{t.ext}</span>
              </span>
            ))}
            . No transcription step — saved as-is for this stage.
          </p>
        )}
        {intakeMode === "audio" && !proxy.reachable && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Run <code className="text-amber-900 dark:text-amber-100">npm run dev</code> and open{" "}
            <code className="text-amber-900 dark:text-amber-100">http://localhost:5173</code> to transcribe.
          </p>
        )}
        {intakeMode === "audio" && proxy.reachable && !proxy.configured && (
          <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
            Add GEMINI_API_KEY to .env and restart the proxy.
          </p>
        )}
        {intakeMode === "audio" && proxy.reachable && proxy.configured && !proxy.assemblyai && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            AssemblyAI is off — files over 25MB cannot transcribe. Add{" "}
            <code className="text-amber-900 dark:text-amber-100">ASSEMBLYAI_API_KEY</code> to .env and restart{" "}
            <code className="text-amber-900 dark:text-amber-100">npm run dev</code> (terminal must show{" "}
            <code className="text-amber-900 dark:text-amber-100">assemblyai set ✓</code>).
          </p>
        )}
        {intakeMode === "audio" && proxy.assemblyai && (
          <p className="mt-2 text-xs text-ink2">
            Transcription: AssemblyAI (diarization) + Gemini (summary)
          </p>
        )}
      </div>

      {err && (
        <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {intakeMode === "audio" ? (
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition ${
              isProcessing
                ? "border-line bg-surface/30 opacity-60"
                : "border-accent/30 bg-surface/20 hover:border-accent/50 hover:bg-surface/40"
            }`}
          >
            <input
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              disabled={isProcessing}
              onChange={handleFileSelect}
            />
            <UploadIcon />
            <p className="mt-3 text-sm font-medium text-ink1">
              {isProcessing
                ? "Working on your recording…"
                : hasSavedRecording
                  ? "Replace recording"
                  : "Add recording"}
            </p>
            <p className="mt-2 text-center text-xs leading-relaxed text-ink2">
              {isProcessing
                ? null
                : hasSavedRecording
                  ? "Choose a new file to replace the current one"
                  : "Drop a file here or click to browse"}
            </p>
            {!isProcessing && (
            <p className="mt-3 flex flex-wrap justify-center gap-x-2 gap-y-1 text-[11px] text-ink2">
              {ACCEPTED_TYPES.map((t) => (
                <span
                  key={t.ext}
                  className="rounded bg-surface2/80 px-1.5 py-0.5 font-mono text-ink2"
                >
                  {t.ext}
                </span>
              ))}
            </p>
            )}
          </label>
          ) : (
          <div className="space-y-3 rounded-xl border border-line bg-surface/30 p-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={isProcessing}
              rows={10}
              placeholder="Paste the full interview transcript or notes here…"
              className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] leading-relaxed text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePasteSave}
                disabled={isProcessing || !pasteText.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accentHover disabled:opacity-50"
              >
                Save transcript
              </button>
              <label className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink1 transition hover:bg-surface2">
                Upload .txt / .md
                <input
                  type="file"
                  accept={ACCEPT_TEXT_ATTR}
                  className="hidden"
                  disabled={isProcessing}
                  onChange={handleTextFileSelect}
                />
              </label>
            </div>
          </div>
          )}

          {isProcessing && (
            <TranscribeProgress jobProgress={jobProgress} onCancel={handleCancel} />
          )}

          {hydrating && !recording && (
            <p className="text-center text-xs text-ink2">Checking for saved recording…</p>
          )}

          {hasSavedRecording && (
            <>
              {/* Metadata + actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink1">
                    {recording.fileName}
                  </p>
                  <p className="text-xs text-ink2">
                    {isTextOnly
                      ? "text transcript"
                      : fmtDuration(recording.durationMs)}
                    {recording.audioBlob?.size
                      ? ` · ${fmtFileSize(recording.audioBlob.size)}`
                      : ""}
                    {recording.provider && ` · ${recording.provider}`}
                    {statusLabel && !isTextOnly && ` · ${statusLabel}`}
                    {isTextOnly && " · ready"}
                  </p>
                  {recording.audioBlob?.size > MAX_UPLOAD_BYTES && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-300">
                      Too large to transcribe — delete and re-upload a compressed file (~64kbps
                      mp3).
                    </p>
                  )}
                  {uploadEstimateMin && !busy && (
                    <p className="mt-1 text-xs text-ink2">
                      Est. upload ~{uploadEstimateMin} min at typical home speeds — compress to
                      mp3 to speed up.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {hasTranscript && (
                    <>
                      <button
                        onClick={handleAddToContext}
                        className="rounded-md bg-emerald-600/90 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Add to context
                      </button>
                      <button
                        onClick={() => handleDownload("txt")}
                        className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2"
                      >
                        .txt
                      </button>
                      <button
                        onClick={() => handleDownload("md")}
                        className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2"
                      >
                        .md
                      </button>
                      <button
                        onClick={() => handleDownload("json")}
                        className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2"
                      >
                        .json
                      </button>
                    </>
                  )}
                  {!isTextOnly && (
                  <button
                    onClick={handleRetranscribe}
                    disabled={busy || !recording.audioBlob}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2 disabled:opacity-50"
                  >
                    {hasTranscript ? "Re-transcribe" : "Transcribe"}
                  </button>
                  )}
                  {busy && (
                    <button
                      onClick={handleCancel}
                      className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink1 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    disabled={busy}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {contextSavedName && (
                <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                  Saved “{contextSavedName}” to Context (enabled). Advisor will use it.
                </p>
              )}

              {/* Playback */}
              {recording.audioBlob && (
                <div className="rounded-lg border border-line bg-surface/30 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink2">
                    Playback
                  </p>
                  <AudioPlayback blob={recording.audioBlob} type={recording.audioType} />
                </div>
              )}

              {/* Summary */}
              {summaryPending && (
                <div className="rounded-lg border border-line bg-surface/30 p-4">
                  <p className="text-sm text-ink2">Generating debrief summary…</p>
                </div>
              )}
              {recording.summary && (
                <div className="rounded-lg border border-line bg-surface/30 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink2">
                    Debrief summary
                  </p>
                  <Markdown>{recording.summary}</Markdown>
                </div>
              )}

              {/* Transcript */}
              {recording.segments?.length > 0 && (
                <div className="rounded-lg border border-line bg-surface/30 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink2">
                    Transcript
                  </p>
                  <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                    {recording.segments.map((seg, i) => {
                      const label =
                        recording.speakers?.find((s) => s.id === seg.speaker)?.label ||
                        `Speaker ${seg.speaker}`;
                      return (
                        <div key={i} className="text-sm leading-relaxed">
                          <span className="font-mono text-[11px] text-ink2">
                            {fmtTimestamp(seg.startMs)}
                          </span>{" "}
                          <span className="font-semibold text-accent">{label}:</span>{" "}
                          <span className="text-ink1">{seg.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const ms = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

function UploadIcon() {
  return (
    <svg
      className="h-8 w-8 text-ink2"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 20h16" />
    </svg>
  );
}
