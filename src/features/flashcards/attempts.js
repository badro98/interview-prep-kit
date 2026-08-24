// Flashcard spoken/text attempts live in IndexedDB (`attempts` store).
// flashcards:progress is a projection of the active attempt for list filters.

import {
  addAttempt,
  updateAttempt,
  getAttemptsForQuestion,
} from "../../lib/db.js";
import { getProgressMap, setCardProgress } from "../../lib/store.js";

export function progressFromAttempt(attempt) {
  return {
    myAnswer: String(attempt?.transcript || ""),
    aiCoaching: String(attempt?.score || ""),
    confidence: attempt?.confidence ?? null,
    lastReviewed: attempt?.lastReviewed ?? attempt?.createdAt ?? null,
    activeAttemptId: attempt?.id || null,
  };
}

export function projectAttempt(cardId, attempt, { touch = false } = {}) {
  if (!attempt) return null;
  return setCardProgress(cardId, progressFromAttempt(attempt), { touch });
}

function progressHasWork(progress) {
  if (!progress) return false;
  return Boolean(
    String(progress.myAnswer || "").trim() ||
      String(progress.aiCoaching || "").trim() ||
      progress.confidence != null
  );
}

function cardFields(card) {
  return {
    questionId: card.id,
    questionText: card.question,
    category: card.category,
    source: "flashcard",
    referenceAnswer: card.referenceAnswer || "",
    keyPoints: Array.isArray(card.keyPoints) ? card.keyPoints : [],
  };
}

export async function createBlankAttempt(card) {
  const created = await addAttempt({
    ...cardFields(card),
    transcript: "",
    score: "",
    confidence: null,
    durationMs: 0,
  });
  projectAttempt(card.id, created, { touch: true });
  return created;
}

/**
 * Load attempts for a card. Migrates legacy flashcards:progress into attempt #1
 * when IndexedDB has no rows yet. Does not create a blank row just by browsing.
 */
export async function loadCardAttempts(card) {
  let attempts = await getAttemptsForQuestion(card.id);
  const progress = getProgressMap()[card.id] || {};

  if (attempts.length === 0 && progressHasWork(progress) && !progress.activeAttemptId) {
    const migrated = await addAttempt({
      ...cardFields(card),
      transcript: progress.myAnswer || "",
      score: progress.aiCoaching || "",
      confidence: progress.confidence ?? null,
      durationMs: 0,
      lastReviewed: progress.lastReviewed || Date.now(),
    });
    attempts = [migrated];
  }

  if (attempts.length === 0) {
    return { attempts: [], activeId: null };
  }

  const activeId =
    progress.activeAttemptId && attempts.some((a) => a.id === progress.activeAttemptId)
      ? progress.activeAttemptId
      : attempts[attempts.length - 1].id;
  const active = attempts.find((a) => a.id === activeId) || attempts[attempts.length - 1];
  projectAttempt(card.id, active, { touch: false });
  return { attempts, activeId: active.id };
}

export async function patchAttempt(cardId, attemptId, patch, { touch = true } = {}) {
  const stamped = touch ? { ...patch, lastReviewed: Date.now() } : patch;
  const updated = await updateAttempt(attemptId, stamped);
  if (updated) projectAttempt(cardId, updated, { touch });
  return updated;
}
