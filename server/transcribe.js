// Interview transcription orchestration — AssemblyAI primary, Gemini fallback.

import {
  transcribeWithDiarization as assemblyTranscribe,
  isConfigured as assemblyConfigured,
} from "./assemblyai.js";
import {
  transcribeAudioWithDiarization,
  mapSpeakers,
  summarizeInterview,
  isConfigured as geminiConfigured,
} from "./gemini.js";
import { getServerContext } from "./context.js";

import {
  buildDiarizationPrompt,
  buildSummaryPrompt,
  buildSpeakerMappingPrompt,
} from "../src/lib/transcribePrompt.js";

export { assemblyConfigured };

const MAX_BYTES = 200 * 1024 * 1024;
/** Gemini JSON diarization breaks on long files — AssemblyAI required above this. */
const GEMINI_DIARIZE_MAX = 25 * 1024 * 1024;

export function normalizeAudioMimeType(mimetype, filename) {
  if (mimetype && mimetype !== "application/octet-stream") return mimetype;
  const ext = filename?.split(".").pop()?.toLowerCase();
  const map = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    webm: "audio/webm",
    aac: "audio/aac",
  };
  return map[ext] || "audio/mp4";
}

function report(onProgress, phase, progress) {
  onProgress?.({ phase, progress });
}

function partialPayload(result) {
  return {
    segments: result.segments,
    speakers: result.speakers,
    durationMs: result.durationMs,
    provider: result.provider,
    summary: "",
  };
}

/**
 * Full pipeline: transcribe + map speakers + summarize.
 */
export async function transcribeInterview({
  buffer,
  mimeType,
  stageId,
  contextBlock,
  fileName,
  onProgress,
  onPartial,
}) {
  if (!geminiConfigured()) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env and restart with `npm run dev`."
    );
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error("Recording exceeds 200MB limit. Trim or compress the file.");
  }

  const resolvedMime = normalizeAudioMimeType(mimeType, fileName);
  const mb = (buffer.length / (1024 * 1024)).toFixed(1);

  report(onProgress, "Starting transcription", 8);

  let result;
  if (assemblyConfigured()) {
    try {
      result = await assemblyTranscribe(buffer, {
        onProgress: ({ phase, progress }) => report(onProgress, phase, progress),
      });
    } catch (e) {
      if (buffer.length > GEMINI_DIARIZE_MAX) {
        throw new Error(
          `AssemblyAI failed (${e.message}). Your file is ${mb}MB — restart \`npm run dev\` and confirm assemblyai set ✓ in the terminal.`
        );
      }
      console.warn("AssemblyAI failed, falling back to Gemini:", e.message);
      report(onProgress, "Transcribing with Gemini (fallback)", 25);
      result = await geminiTranscribe(buffer, resolvedMime);
    }
  } else if (buffer.length > GEMINI_DIARIZE_MAX) {
    throw new Error(
      `File is ${mb}MB. Add ASSEMBLYAI_API_KEY to .env and restart \`npm run dev\` — Gemini cannot diarize long recordings reliably.`
    );
  } else {
    report(onProgress, "Transcribing with Gemini", 25);
    result = await geminiTranscribe(buffer, resolvedMime);
  }

  report(onProgress, "Transcript ready", 76);
  onPartial?.(partialPayload(result));

  const context = contextBlock?.trim() || getServerContext();
  const summaryPrompt = buildSummaryPrompt({
    stageId,
    segments: result.segments,
    speakers: result.speakers,
    context,
  });

  report(onProgress, "Labeling speakers & generating summary", 82);

  const [mapped, summary] = await Promise.all([
    result.segments?.length
      ? mapSpeakers({ prompt: buildSpeakerMappingPrompt(result.segments) })
      : Promise.resolve(null),
    summarizeInterview({ prompt: summaryPrompt }),
  ]);

  if (mapped?.length) result.speakers = mapped;

  report(onProgress, "Done", 100);

  return {
    segments: result.segments,
    speakers: result.speakers,
    durationMs: result.durationMs,
    summary,
    provider: result.provider,
  };
}

async function geminiTranscribe(buffer, mimeType) {
  return transcribeAudioWithDiarization({
    buffer,
    mimeType: mimeType || "audio/mp4",
    prompt: buildDiarizationPrompt(),
  });
}
