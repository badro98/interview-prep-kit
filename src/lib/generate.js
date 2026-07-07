// In-app generation — routes prep-doc regeneration and flashcard-deck generation
// through coach(), the single pluggable AI entry point (see coach.js).
//
// Callers (PrepDocs regenerate, the onboarding wizard) get back the same
// { mode: 'paste', prompt } | { mode: 'api', text|cards } shape coach() itself
// returns, so paste-mode fallback UI stays uniform across features.

import { coach } from "./coach.js";
import { setDocOverride } from "./store.js";

const CATEGORY_IDS = ["behavioral", "situational", "role-specific"];
const MAX_CARDS = 30;

/**
 * Regenerate a single stage's prep doc. Mirrors PrepDocs' existing regenerate
 * pattern: grounds the model in the active job's full context.
 *
 * @param {{id: string, regenTask: string}} stage
 * @returns {Promise<{mode:'paste', prompt:string} | {mode:'api', text:string}>}
 */
export function generateStageDoc(stage) {
  return coach({ task: stage.regenTask, includeContext: true });
}

/** Thin wrapper so wizard/UI code doesn't need to import store.js directly. */
export function saveStageDoc(stageId, markdown) {
  setDocOverride(stageId, markdown);
}

/** Build the coach() task asking for a fresh, role-tailored flashcard deck. */
export function buildFlashcardsTask(job) {
  const role = job?.role || "this role";
  const company = job?.company || "this company";

  return `Generate 20-25 interview flashcards for the ${role} role at ${company}, tailored to my background and the job description in my context.

Spread the cards across these categories: "behavioral", "situational", "role-specific".

Return ONLY a strict JSON array, no prose, no markdown fences, in exactly this shape:
[
  {
    "category": "behavioral",
    "question": "...",
    "referenceAnswer": "...",
    "keyPoints": ["...", "..."]
  }
]

Each card must have all four fields. "category" must be one of "behavioral", "situational", or "role-specific". "keyPoints" is an array of short strings a strong answer should hit.`;
}

function coerceCategory(category) {
  return CATEGORY_IDS.includes(category) ? category : "role-specific";
}

function coerceCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.question !== "string" || !raw.question.trim()) return null;

  return {
    category: coerceCategory(raw.category),
    question: raw.question.trim(),
    referenceAnswer: typeof raw.referenceAnswer === "string" ? raw.referenceAnswer : "",
    keyPoints: Array.isArray(raw.keyPoints)
      ? raw.keyPoints.filter((k) => typeof k === "string")
      : [],
  };
}

function extractJsonArray(text) {
  let raw = String(text || "").trim();

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();

  if (raw[0] !== "[") {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) raw = raw.slice(start, end + 1);
  }

  return raw;
}

/**
 * Tolerant parse of a coach() flashcards reply into card objects.
 * Strips code fences / surrounding prose, validates each card, drops invalid
 * ones, and caps the result at MAX_CARDS.
 *
 * @returns {{cards: Array, dropped: number}}
 * @throws {Error} "Could not parse flashcards" when zero cards are valid.
 */
export function parseFlashcards(text) {
  const raw = extractJsonArray(text);

  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error("Could not parse flashcards");
  }
  if (!Array.isArray(arr)) throw new Error("Could not parse flashcards");

  const valid = [];
  let dropped = 0;
  for (const item of arr) {
    const card = coerceCard(item);
    if (card) valid.push(card);
    else dropped++;
  }

  if (valid.length === 0) throw new Error("Could not parse flashcards");

  const kept = valid.slice(0, MAX_CARDS);
  dropped += valid.length - kept.length;

  const now = Date.now();
  const cards = kept.map((card, i) => ({ id: `gen-${now}-${i}`, ...card }));

  return { cards, dropped };
}

/**
 * Generate a fresh flashcard deck for a job via coach(). API mode parses and
 * returns the cards for the caller to persist (addCustomCards); paste mode
 * returns the prompt for the caller to run parseFlashcards() on the reply.
 */
export async function generateFlashcards(job) {
  const task = buildFlashcardsTask(job);
  const result = await coach({ task, includeContext: true });

  if (result.mode === "api") {
    const { cards, dropped } = parseFlashcards(result.text);
    return { mode: "api", cards, dropped };
  }

  return { mode: "paste", prompt: result.prompt };
}
