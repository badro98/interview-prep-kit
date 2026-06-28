// Client wrapper for interview transcription (API mode only).
// Mirrors the coach() / geminiScore.js pattern — key stays server-side.

import { getContext } from "./context.js";

const POLL_MS = 2000;

/** Gemini diarization is only reliable under this size — larger files need AssemblyAI. */
export const ASSEMBLYAI_REQUIRED_BYTES = 25 * 1024 * 1024;

function apiUrl(path) {
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_API_PORT || 3001;
    return `http://localhost:${port}${path}`;
  }
  return path;
}

/** Overall progress bands (0–100, no artificial caps mid-upload). */
const BAND = {
  saving: [0, 4],
  uploading: [4, 32],
  processing: [32, 38],
  transcribing: [38, 82],
  summarizing: [82, 99],
  done: [100, 100],
};

/**
 * @typedef {'saving'|'uploading'|'processing'|'transcribing'|'summarizing'|'done'} TranscribeStep
 * @typedef {{ step: TranscribeStep, label: string, detail?: string|null, progress: number }} TranscribeProgressUpdate
 */

export class TranscribeCancelledError extends Error {
  constructor(message = "Transcription cancelled.") {
    super(message);
    this.name = "TranscribeCancelledError";
  }
}

export function isTranscribeCancelled(err) {
  return err instanceof TranscribeCancelledError || err?.name === "TranscribeCancelledError";
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new TranscribeCancelledError();
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TranscribeCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new TranscribeCancelledError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function bandProgress(step, ratio = 1) {
  const [lo, hi] = BAND[step] || [0, 0];
  if (step === "done") return 100;
  const r = Math.min(1, Math.max(0, ratio));
  return Math.round(lo + r * (hi - lo));
}

function mapServerToProgress(serverProgress, serverPhase) {
  const p = Number(serverProgress) || 0;
  if (/summary|label|finishing/i.test(serverPhase || "")) {
    return bandProgress("summarizing", Math.min(1, (p - 76) / 24 || 0.5));
  }
  if (p <= 5) return BAND.transcribing[0];
  if (p >= 75) return BAND.transcribing[1];
  return Math.round(BAND.transcribing[0] + ((p - 5) / 70) * (BAND.transcribing[1] - BAND.transcribing[0]));
}

function serverPhaseToStep(serverPhase) {
  if (/summary|label|finishing/i.test(serverPhase || "")) return "summarizing";
  return "transcribing";
}

/** Short label for file metadata row while a job is running. */
export function progressStepLabel(step) {
  const labels = {
    saving: "saving…",
    uploading: "uploading…",
    processing: "processing…",
    transcribing: "transcribing…",
    summarizing: "summarizing…",
    done: "done",
  };
  return labels[step] || "working…";
}

function postFormWithUploadProgress(url, form, onUploadProgress, { signal } = {}) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = 60 * 60 * 1000;

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      const ratio = e.loaded / e.total;
      const mbTotal = (e.total / (1024 * 1024)).toFixed(1);

      if (ratio >= 0.999) {
        onUploadProgress?.({
          step: "processing",
          label: "Finishing upload on server…",
          detail: `${mbTotal} MB sent — waiting for server to accept the file`,
          progress: bandProgress("processing", 0.2),
        });
        return;
      }

      const mbLoaded = (e.loaded / (1024 * 1024)).toFixed(1);
      onUploadProgress?.({
        step: "uploading",
        label: `Uploading ${mbLoaded} / ${mbTotal} MB`,
        detail: null,
        progress: bandProgress("uploading", ratio),
      });
    });

    xhr.addEventListener("load", () => {
      if (signal?.aborted) {
        reject(new TranscribeCancelledError());
        return;
      }
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body || {});
        return;
      }
      reject(new Error(body?.error || `Transcription proxy error ${xhr.status}`));
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.addEventListener("abort", () => reject(new TranscribeCancelledError()));
    xhr.addEventListener("timeout", () =>
      reject(new Error("Upload timed out. Try exporting as mono .mp3 (~64kbps) for faster uploads."))
    );

    xhr.send(form);
  });
}

/** Rough upload estimate: browser → proxy → AssemblyAI (2 hops). */
export function estimateUploadMinutes(fileBytes, mbps = 1.5) {
  if (!fileBytes) return null;
  const megabits = (fileBytes * 8 * 2) / (1024 * 1024);
  const seconds = megabits / mbps;
  if (seconds < 45) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Proxy health including transcription provider availability. */
export async function getTranscribeStatus() {
  try {
    const res = await fetch(apiUrl("/api/health"));
    if (!res.ok) return { reachable: false, configured: false, assemblyai: false };
    const data = await res.json();
    return {
      reachable: true,
      configured: !!data.configured,
      assemblyai: !!data.assemblyai,
      model: data.model,
    };
  } catch {
    return { reachable: false, configured: false, assemblyai: false };
  }
}

async function pollJob(
  jobId,
  { onProgress, onPartial, progressFloor = BAND.transcribing[0], signal } = {}
) {
  let lastPartialKey = "";
  let lastProgress = progressFloor;
  while (true) {
    throwIfAborted(signal);
    const res = await fetch(apiUrl(`/api/transcribe-jobs/${jobId}`));
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch {
        /* ignore */
      }
      throw new Error(detail || `Could not check transcription status (${res.status})`);
    }
    const job = await res.json();

    if (job.status === "cancelled") {
      throw new TranscribeCancelledError();
    }

    if (job.partialResult) {
      const key = `${job.partialResult.segments?.length || 0}-${job.progress}`;
      if (key !== lastPartialKey) {
        lastPartialKey = key;
        onPartial?.(job.partialResult);
      }
      const mapped = Math.max(lastProgress, bandProgress("summarizing", 0.35));
      lastProgress = mapped;
      onProgress?.({
        step: "summarizing",
        label: "Generating debrief summary…",
        detail: "Transcript is ready below — this step usually takes 1–2 min",
        progress: mapped,
      });
    } else if (job.phase) {
      const step = serverPhaseToStep(job.phase);
      const mapped = Math.max(lastProgress, mapServerToProgress(job.progress ?? 0, job.phase));
      lastProgress = mapped;
      onProgress?.({
        step,
        label: job.phase,
        detail: step === "transcribing" ? "Usually 5–10 min for a 45 min recording" : null,
        progress: mapped,
      });
    }

    if (job.status === "done") {
      onProgress?.({ step: "done", label: "Complete", progress: 100 });
      return job.result;
    }
    if (job.status === "error") {
      throw new Error(job.error || "Transcription failed.");
    }
    await wait(POLL_MS, signal);
  }
}

/** Poll an existing server job (resume after tab switch / refresh). */
export function pollTranscribeJob(jobId, callbacks) {
  return pollJob(jobId, callbacks);
}

/** Peek job status without polling loop. */
export async function fetchTranscribeJob(jobId) {
  const res = await fetch(apiUrl(`/api/transcribe-jobs/${jobId}`));
  if (!res.ok) return null;
  return res.json();
}

/** Ask the server to mark a job cancelled (best-effort). */
export async function cancelTranscribeJob(jobId) {
  if (!jobId) return;
  try {
    await fetch(apiUrl(`/api/transcribe-jobs/${jobId}`), { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

/**
 * Upload a Voice Memo and transcribe via the local proxy (async job + polling).
 * @param {{ stageId: string, file: File, signal?: AbortSignal, onProgress?: (u: TranscribeProgressUpdate) => void, onPartial?: Function, onJobStarted?: (jobId: string) => void }}
 */
export async function transcribeInterview({
  stageId,
  file,
  signal,
  onProgress,
  onPartial,
  onJobStarted,
}) {
  throwIfAborted(signal);
  const status = await getTranscribeStatus();
  if (!status.reachable) {
    throw new Error(
      "Interview transcription needs the local API server. Run `npm run dev:api` (instead of `npm run dev`)."
    );
  }
  if (!status.configured) {
    throw new Error("Add GEMINI_API_KEY to your .env, then restart `npm run dev:api`.");
  }
  if (file.size > ASSEMBLYAI_REQUIRED_BYTES && !status.assemblyai) {
    throw new Error(
      `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB — recordings over 25MB need AssemblyAI. Add ASSEMBLYAI_API_KEY to .env and restart \`npm run dev:api\` (terminal must show assemblyai set ✓).`
    );
  }

  onProgress?.({
    step: "uploading",
    label: "Starting upload…",
    progress: bandProgress("uploading", 0),
  });

  const form = new FormData();
  form.append("stageId", stageId);
  form.append("file", file);
  form.append("context", getContext());

  const data = await postFormWithUploadProgress(
    apiUrl("/api/transcribe-interview"),
    form,
    onProgress,
    { signal }
  );

  throwIfAborted(signal);
  if (!data?.jobId) throw new Error("Server did not return a transcription job id.");

  const { jobId } = data;
  onJobStarted?.(jobId);

  const postUpload = bandProgress("processing", 1);
  onProgress?.({
    step: "transcribing",
    label: "Upload complete — starting transcription",
    detail: null,
    progress: postUpload,
  });

  return pollJob(jobId, { onProgress, onPartial, progressFloor: postUpload, signal });
}
