// Prompts for interview transcription + stage-aware debrief summaries.

import {
  TRANSCRIBE_STAGES,
  TRANSCRIBE_STAGE_INSTRUCTIONS,
  buildSpeakerMappingPrompt as candidateLine,
} from "../../interview.config.js";
import { getActiveJob } from "./jobs.js";

/** Active job's stage metadata (id/title/subtitle) for the summary pass. */
function getStages() {
  return (getActiveJob()?.stages || []).map(({ id, title, subtitle }) => ({
    id,
    title,
    subtitle,
  }));
}

export function getStageSummaryInstructions(stageId) {
  // Server-side (Node) there is no active job — fall back to the config stages
  // so id-matching stages keep their full title/subtitle line.
  const stage =
    getStages().find((s) => s.id === stageId) ||
    TRANSCRIBE_STAGES.find((s) => s.id === stageId);
  // Preset stage ids match config ids, so instructions still resolve for preset jobs.
  const specific = TRANSCRIBE_STAGE_INSTRUCTIONS[stageId] || "";
  return [
    stage ? `Stage: ${stage.title} — ${stage.subtitle}` : `Stage: ${stageId}`,
    specific,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Gemini fallback: structured diarized transcription from audio. */
export function buildDiarizationPrompt() {
  return `Transcribe this interview recording with speaker diarization.

Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "durationMs": number,
  "speakers": [{ "id": "A", "label": "Speaker A" }],
  "segments": [
    { "speaker": "A", "startMs": 0, "endMs": 5200, "text": "..." }
  ]
}

Rules:
- Identify distinct speakers (typically 2: candidate and interviewer; use A, B, C…).
- Timestamps in milliseconds from the start of the recording.
- Preserve spoken content faithfully; include filler words but skip long dead air.
- Merge adjacent lines from the same speaker when natural.
- If unsure who is who, keep generic labels — a later pass will map them.`;
}

/** Text-only summary after diarization (AssemblyAI or Gemini). */
export function excerptSegmentsForSummary(segments, { maxChars = 30000 } = {}) {
  const list = segments || [];
  if (!list.length) return { segments: list, excerptNote: null };

  const fullText = list
    .map((seg) => seg.text || "")
    .join(" ");
  if (fullText.length <= maxChars) {
    return { segments: list, excerptNote: null };
  }

  const OPEN_MS = 12 * 60 * 1000;
  const CLOSE_MS = 10 * 60 * 1000;
  const endMs = list.at(-1)?.endMs || list.at(-1)?.startMs || 0;

  const opening = list.filter((s) => (s.startMs || 0) < OPEN_MS);
  const closing = list.filter((s) => (s.startMs || 0) >= endMs - CLOSE_MS);
  const middle = list.filter(
    (s) =>
      (s.startMs || 0) >= OPEN_MS && (s.startMs || 0) < endMs - CLOSE_MS
  );

  const middlePick = [];
  if (middle.length > 0) {
    const step = Math.max(1, Math.floor(middle.length / 24));
    for (let i = 0; i < middle.length; i += step) {
      middlePick.push(middle[i]);
    }
  }

  const seen = new Set();
  const merged = [];
  for (const seg of [...opening, ...middlePick, ...closing]) {
    const key = `${seg.startMs}-${seg.speaker}-${seg.text?.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(seg);
  }

  merged.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  return {
    segments: merged,
    excerptNote: `Full transcript is ~${Math.round(fullText.length / 1000)}k characters; summary uses opening, closing, and sampled middle sections.`,
  };
}

export function buildSummaryPrompt({ stageId, segments, speakers, context }) {
  const stageBlock = getStageSummaryInstructions(stageId);
  const speakerLegend = (speakers || [])
    .map((s) => `${s.id} = ${s.label}`)
    .join(", ");

  const { segments: summarySegments, excerptNote } = excerptSegmentsForSummary(segments);

  const transcript = summarySegments
    .map((seg) => {
      const label =
        speakers?.find((s) => s.id === seg.speaker)?.label || `Speaker ${seg.speaker}`;
      const ts = formatTimestamp(seg.startMs);
      return `[${ts}] ${label}: ${seg.text}`;
    })
    .join("\n");

  return [
    context?.trim() || "(No candidate context provided.)",
    "\n----------------------------------------\n",
    stageBlock,
    "\n\nYou are debriefing the candidate after their interview. Use the context above as ground truth — reference their real stories and metrics when relevant, never invent experiences.",
    excerptNote
      ? `\n\nNOTE: ${excerptNote} Cover the full arc of the conversation in your debrief.`
      : "",
    "\n\nDIARIZED TRANSCRIPT",
    speakerLegend ? `(Speakers: ${speakerLegend})` : "",
    transcript,
    "\n\nWrite a Markdown debrief with these sections:",
    "## Overall summary",
    "## Questions they asked you",
    "## Questions you asked them",
    "## Topics to follow up on / add to context",
    "\nBe specific and actionable. Quote or paraphrase key questions where helpful.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Map generic speaker IDs to You / Interviewer via a short text pass. */
export function buildSpeakerMappingPrompt(segments) {
  const sample = (segments || [])
    .slice(0, 12)
    .map((seg) => `${seg.speaker}: ${seg.text}`)
    .join("\n");

  return `Below are the first lines of an interview transcript with generic speaker labels (A, B, etc.).
${candidateLine()}
Decide which speaker is the candidate ("You") and which is the interviewer ("Interviewer").
If there are 3+ speakers, label extras "Interviewer 2", etc.

Return ONLY valid JSON (no markdown fences):
{ "speakers": [{ "id": "A", "label": "You" }, { "id": "B", "label": "Interviewer" }] }

Sample:
${sample}`;
}

function formatTimestamp(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Client-side export helpers. */
export function transcriptToTxt({ segments, speakers }) {
  return (segments || [])
    .map((seg) => {
      const label =
        speakers?.find((s) => s.id === seg.speaker)?.label || `Speaker ${seg.speaker}`;
      return `${label}: ${seg.text}`;
    })
    .join("\n\n");
}

export function transcriptToMd({ segments, speakers, summary, stageTitle, fileName }) {
  const header = [
    `# Interview recording — ${stageTitle || "Stage"}`,
    fileName ? `File: ${fileName}` : "",
    "",
    "## Summary",
    summary || "(No summary)",
    "",
    "## Transcript",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const body = (segments || [])
    .map((seg) => {
      const label =
        speakers?.find((s) => s.id === seg.speaker)?.label || `Speaker ${seg.speaker}`;
      const ts = formatTimestamp(seg.startMs);
      return `**[${ts}] ${label}:** ${seg.text}`;
    })
    .join("\n\n");

  return `${header}\n\n${body}`;
}

export function transcriptToJson(recording) {
  const { audioBlob, ...rest } = recording;
  return JSON.stringify(
    {
      ...rest,
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

