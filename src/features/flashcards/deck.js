// Flashcard deck logic — load the build-time seed deck, merge in custom cards and
// per-card progress, and build the coach() prompts.

import seed from "../../../generated/flashcards.json";
import {
  getProgressMap,
  getCustomCards,
  getModelOverrides,
} from "../../lib/store.js";

export const CATEGORIES = [
  { id: "behavioral", label: "Behavioral" },
  { id: "situational", label: "Situational" },
  { id: "cursor-specific", label: "Cursor-specific" },
];

export const categoryLabel = (id) =>
  CATEGORIES.find((c) => c.id === id)?.label || id;

export const deckMeta = seed.meta || {};

/** Original model answer from the seed/custom deck (before local overrides). */
export function getOriginalModel(cardId) {
  const c = [...(seed.cards || []), ...getCustomCards()].find((x) => x.id === cardId);
  if (!c) return null;
  return {
    referenceAnswer: c.referenceAnswer || "",
    keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints : [],
  };
}

/**
 * Returns the full deck: seed cards + custom cards, each merged with progress
 * and any model-answer overrides you've saved.
 */
export function getDeck() {
  const progress = getProgressMap();
  const modelOverrides = getModelOverrides();
  const all = [...(seed.cards || []), ...getCustomCards()];
  return all.map((c) => {
    const p = progress[c.id] || {};
    const mo = modelOverrides[c.id];
    return {
      id: c.id,
      category: c.category,
      question: c.question,
      referenceAnswer: mo?.referenceAnswer ?? c.referenceAnswer ?? "",
      keyPoints: mo?.keyPoints ?? (Array.isArray(c.keyPoints) ? c.keyPoints : []),
      referenceIsCustom: !!mo,
      myAnswer: p.myAnswer || "",
      aiCoaching: p.aiCoaching || "",
      confidence: p.confidence ?? null,
      lastReviewed: p.lastReviewed ?? null,
    };
  });
}

// ---- coach() prompt builders --------------------------------------------------

// Machine-readable marker the model appends so we can extract the score in paste mode.
export const CONFIDENCE_MARKER = "CONFIDENCE";

/**
 * "Coach me" — compares my answer against the card's gold-standard referenceAnswer
 * and keyPoints, then returns structured feedback + an assigned confidence (1-5).
 * If I've answered before, it adjusts the prior confidence rather than overwriting blind.
 */
export function buildCoachTask({
  question,
  category,
  myAnswer,
  referenceAnswer,
  keyPoints = [],
  confidence = null,
}) {
  const hasReference = referenceAnswer && referenceAnswer.trim();
  const keyPointsBlock =
    keyPoints.length > 0
      ? keyPoints.map((k) => `- ${k}`).join("\n")
      : "(none provided)";

  const referenceBlock = hasReference
    ? `GOLD-STANDARD REFERENCE ANSWER (the target — do not just repeat it back to me):
${referenceAnswer}

KEY POINTS a strong answer should cover:
${keyPointsBlock}`
    : `KEY POINTS a strong answer should cover:
${keyPointsBlock}
(No reference answer for this card — judge against the key points and my real background.)`;

  const priorBlock =
    confidence != null
      ? `\nI previously scored this card ${confidence}/5. ADJUST from that baseline based on this attempt — nudge it up or down, don't overwrite it blind. A big improvement or regression can move it more than one point.`
      : `\nThis is my first scored attempt at this card.`;

  return `I'm preparing for the Cursor Product Quality Engineer interview. Coach my answer to this ${categoryLabel(
    category
  )} question by comparing it against the gold-standard reference and key points below.

QUESTION:
${question}

${referenceBlock}

MY ANSWER (typed or spoken-then-transcribed):
${myAnswer}
${priorBlock}

Respond in Markdown with EXACTLY these sections:

**Key points covered** — list each key point I hit (quote/paraphrase where I hit it).
**Key points missed** — list the key points I left out or were too vague on.
**What's strong** — what already lands well in my delivery.
**Tightened version** — a crisp, interview-ready rewrite in my own voice: concrete numbers from my real background, STAR-ish where it fits, lands the point and stops (no rambling).

Then, as the very last line and nothing after it, output the score on its own line in exactly this format:
${CONFIDENCE_MARKER}: N
where N is an integer 1-5 (1 = shaky, 5 = interview-ready) reflecting key-point coverage AND delivery${
    confidence != null ? ", adjusted from my prior score" : ""
  }.`;
}

/**
 * Parse the coach reply into { coaching, confidence }.
 * Extracts the trailing "CONFIDENCE: N" marker (and strips it from the displayed text).
 */
export function parseCoaching(text) {
  if (!text) return { coaching: "", confidence: null };
  const raw = String(text);
  const re = new RegExp(`${CONFIDENCE_MARKER}\\s*[:=]\\s*([1-5])`, "i");
  const m = raw.match(re);
  const confidence = m ? Number(m[1]) : null;
  // Remove the marker line from the body shown to the user.
  const coaching = raw
    .replace(new RegExp(`^.*${CONFIDENCE_MARKER}\\s*[:=]\\s*[1-5].*$`, "im"), "")
    .trim();
  return { coaching: coaching || raw.trim(), confidence };
}

/** Pull the coach's "Tightened version" section for promoting to model answer. */
export function parseTightenedVersion(coaching) {
  if (!coaching) return null;
  const m = coaching.match(
    /\*\*Tightened version\*\*[—:\s]*([\s\S]*?)(?=\n\*\*|\nCONFIDENCE\s*:|$)/i
  );
  const text = m?.[1]?.trim();
  return text || null;
}

/** One plain-text block: dash-prefixed key points, blank line, then the answer. */
export function formatModelAnswerText(referenceAnswer, keyPoints = []) {
  const bullets = (keyPoints || []).filter(Boolean).map((k) => `- ${k}`).join("\n");
  const body = (referenceAnswer || "").trim();
  if (!bullets) return body;
  if (!body) return bullets;
  return `${bullets}\n\n${body}`;
}

/** Split edited text back into keyPoints (leading `-` lines) + referenceAnswer (rest). */
export function parseModelAnswerText(text) {
  const lines = String(text || "").split("\n");
  const keyPoints = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    if (/^-\s+/.test(trimmed)) {
      keyPoints.push(trimmed.replace(/^-\s+/, "").trim());
      i++;
    } else {
      break;
    }
  }
  const referenceAnswer = lines.slice(i).join("\n").trim();
  return { keyPoints, referenceAnswer };
}

/** "Generate more" — ask for additional role-tailored questions as JSON. */
export function buildGenerateTask({ count = 8, existingQuestions = [] }) {
  const avoid =
    existingQuestions.length > 0
      ? `\n\nDo NOT repeat these existing questions:\n- ${existingQuestions
          .slice(0, 60)
          .join("\n- ")}`
      : "";

  return `Generate ${count} additional interview flashcard QUESTIONS (questions only, no answers) for the Cursor Product Quality Engineer role, tailored to my background.

Spread them across these categories: "behavioral", "situational", "cursor-specific". Focus on escalation judgment, customer communication, ambiguity, prioritization, AI-native workflows, and the QA->support pivot.

Return ONLY a JSON array, no prose, no code fences, in exactly this shape:
[
  { "category": "behavioral", "question": "..." },
  { "category": "situational", "question": "..." }
]${avoid}`;
}

/**
 * Parse the model's reply for "generate more" into card objects with ids.
 * Tolerant of code fences / surrounding prose.
 */
export function parseGenerated(text) {
  if (!text) return [];
  let raw = String(text).trim();

  // Strip ```json ... ``` fences if present.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();

  // Otherwise grab the outermost array.
  if (raw[0] !== "[") {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) raw = raw.slice(start, end + 1);
  }

  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const validCats = new Set(CATEGORIES.map((c) => c.id));
  return arr
    .filter((x) => x && typeof x.question === "string" && x.question.trim())
    .map((x) => ({
      id: `gen-${slug(x.question)}-${Math.random().toString(36).slice(2, 7)}`,
      category: validCats.has(x.category) ? x.category : "behavioral",
      question: x.question.trim(),
    }));
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
