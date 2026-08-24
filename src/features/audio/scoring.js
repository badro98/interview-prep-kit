// Prompts for scoring a SPOKEN answer.
//
// buildScoreTask    → transcript-only (paste mode / Claude). Judges wording/structure.
// buildAudioScoreTask → sent WITH the audio to an audio-native model (Gemini), so it
//   can also judge VOCAL tone: pace, pauses, filler words, confidence, warmth, energy.

import { APP } from "../../../interview.config.js";
import { CONFIDENCE_MARKER } from "../flashcards/deck.js";

const CONFIDENCE_LINE = `Then, as the very last line and nothing after it, output the score on its own line in exactly this format:
${CONFIDENCE_MARKER}: N
where N is an integer 1-5 (1 = shaky, 5 = interview-ready).`;

const roleLabel = () => `${APP.role} role at ${APP.company}`;

export function buildAudioScoreTask({
  questionText,
  referenceAnswer,
  keyPoints = [],
}) {
  const hasRef = referenceAnswer && referenceAnswer.trim();
  const keyPointsBlock =
    keyPoints.length > 0 ? keyPoints.map((k) => `- ${k}`).join("\n") : "";

  const baseline = hasRef
    ? `\nGOLD-STANDARD REFERENCE (content target — do not just read it back):\n${referenceAnswer}\n${
        keyPointsBlock ? `\nKey points a strong answer covers:\n${keyPointsBlock}\n` : ""
      }`
    : keyPointsBlock
    ? `\nKey points a strong answer covers:\n${keyPointsBlock}\n`
    : "";

  return `LISTEN to the attached audio of me answering an interview question out loud, then judge BOTH my vocal delivery and my content. This is delivery practice for the ${roleLabel()} interview.

You can hear the actual audio — use it. Judge tone and delivery from how I sound, not just the words.

QUESTION:
${questionText}
${baseline}
Respond in Markdown with EXACTLY these sections:

**Vocal delivery** — pace (too fast/slow/rushed endings), pauses and hesitation, filler words ("um", "uh", "like", "you know") with rough counts, vocal confidence, warmth, and energy. Rate 1-5 with specifics you actually heard.
**Structure** — clear opening point, logical arc (STAR-ish where it fits), clean resolution. Rate 1-5.
**Specificity** — concrete details, real metrics, named examples vs. vague generalities. Rate 1-5.
**Concision & landing** — tight and well-paced, and did I end on a strong note or trail off? Rate 1-5.
**Top 3 fixes** — the highest-leverage things to change next attempt.
**Tightened version** — a crisp ~60–90 second spoken version in my own voice, with concrete numbers from my real background, that lands the point and stops.

${CONFIDENCE_LINE}

Be honest about weak delivery — tone feedback is the whole point.`;
}

export function buildScoreTask({
  questionText,
  transcript,
  referenceAnswer,
  keyPoints = [],
}) {
  const hasRef = referenceAnswer && referenceAnswer.trim();
  const keyPointsBlock =
    keyPoints.length > 0 ? keyPoints.map((k) => `- ${k}`).join("\n") : "";

  const baseline = hasRef
    ? `\nGOLD-STANDARD REFERENCE (content target — do not just read it back):
${referenceAnswer}
${keyPointsBlock ? `\nKey points a strong answer covers:\n${keyPointsBlock}` : ""}\n`
    : keyPointsBlock
    ? `\nKey points a strong answer covers:\n${keyPointsBlock}\n`
    : "";

  return `Score my SPOKEN interview answer below. It was recorded out loud and auto-transcribed, so ignore minor transcription artifacts, punctuation, and filler-word spelling — judge the DELIVERY, not the transcription.

This is delivery practice for the ${roleLabel()} interview. Focus on how I framed and delivered the answer.

QUESTION:
${questionText}
${baseline}
MY SPOKEN ANSWER (transcript):
${transcript}

Respond in Markdown with EXACTLY these sections:

**Structure** — did it open with a clear point, follow a logical arc (STAR-ish where it fits), and resolve? Rate 1-5 with a one-line why.
**Specificity** — concrete details, real metrics, named examples vs. vague generalities? Rate 1-5 with a one-line why.
**Concision** — tight and well-paced, or rambling/repetitive? Call out filler and where I should cut. Rate 1-5 with a one-line why.
**Landing the point** — did it end on a strong, memorable note or trail off? Rate 1-5 with a one-line why.
**Tightened version** — a crisp ~60–90 second spoken version in my own voice that I could actually say out loud: natural, concrete numbers from my real background, lands the point and stops.

${CONFIDENCE_LINE}

Keep it specific and reference my real stories/metrics. Be honest about weak delivery — that's the point.`;
}
