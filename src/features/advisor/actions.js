// Parse and execute structured advisor proposals (flashcards, context).

import { CATEGORIES, categoryLabel, getDeck } from "../flashcards/deck.js";
import { addCustomCards, addCustomContextEntry } from "../../lib/store.js";

const ACTIONS_FENCE = /```advisor-actions\s*([\s\S]*?)```/i;

const VALID_CATS = new Set(CATEGORIES.map((c) => c.id));

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Remove the machine-readable actions block from chat display text. */
export function stripAdvisorActions(text) {
  if (!text) return "";
  return String(text).replace(ACTIONS_FENCE, "").trim();
}

/**
 * Extract proposal objects from an assistant message.
 * @returns {Array<{ id, type, label, ... }>}
 */
export function parseAdvisorActions(text) {
  if (!text) return [];
  const m = String(text).match(ACTIONS_FENCE);
  if (!m) return [];

  let payload;
  try {
    payload = JSON.parse(m[1].trim());
  } catch {
    return [];
  }

  const raw = Array.isArray(payload?.proposals) ? payload.proposals : [];
  return raw
    .map((p, i) => normalizeProposal(p, i))
    .filter(Boolean);
}

function normalizeProposal(p, index) {
  if (!p || !p.type) return null;

  if (p.type === "add_flashcards") {
    const cards = (p.cards || [])
      .filter((c) => c && typeof c.question === "string" && c.question.trim())
      .map((c) => ({
        id: `adv-${slug(c.question)}-${Math.random().toString(36).slice(2, 7)}`,
        category: VALID_CATS.has(c.category) ? c.category : "behavioral",
        question: c.question.trim(),
        referenceAnswer: (c.referenceAnswer || "").trim(),
        keyPoints: Array.isArray(c.keyPoints)
          ? c.keyPoints.filter(Boolean).map(String)
          : [],
      }));
    if (cards.length === 0) return null;
    return {
      id: p.id || `flashcards-${index}`,
      type: "add_flashcards",
      label: p.label || `Add ${cards.length} flashcard${cards.length === 1 ? "" : "s"}`,
      cards,
    };
  }

  if (p.type === "add_context") {
    const name = (p.name || "").trim();
    const content = (p.content || "").trim();
    if (!name || !content) return null;
    return {
      id: p.id || `context-${index}`,
      type: "add_context",
      label: p.label || `Save “${name}” to context`,
      name,
      content,
      sourceUrl: p.sourceUrl || null,
    };
  }

  return null;
}

/** Apply a confirmed proposal. Returns a short result message. */
export function executeAdvisorProposal(proposal) {
  if (!proposal) return { ok: false, message: "Nothing to apply." };

  if (proposal.type === "add_flashcards") {
    const existingQs = new Set(
      getDeck().map((c) => c.question.toLowerCase().trim())
    );
    const novel = proposal.cards.filter(
      (c) => !existingQs.has(c.question.toLowerCase().trim())
    );
    const skipped = proposal.cards.length - novel.length;
    const added = addCustomCards(novel);
    let message =
      added > 0
        ? `Added ${added} card${added === 1 ? "" : "s"} to your flashcard deck.`
        : "No new cards added.";
    if (skipped > 0) {
      message += ` (${skipped} duplicate question${skipped === 1 ? "" : "s"} skipped.)`;
    }
    return {
      ok: added > 0,
      message,
      kind: "flashcards",
      count: added,
    };
  }

  if (proposal.type === "add_context") {
    const entry = addCustomContextEntry({
      name: proposal.name,
      content: proposal.sourceUrl
        ? `${proposal.content.trim()}\n\n---\nSource: ${proposal.sourceUrl}`
        : proposal.content,
    });
    return {
      ok: true,
      message: `Saved “${entry.name}” to custom context (enabled by default).`,
      kind: "context",
    };
  }

  return { ok: false, message: "Unknown proposal type." };
}

/** Compact deck summary for advisor grounding. */
export function formatFlashcardsForAdvisor(deck) {
  if (!deck?.length) {
    return "FLASHCARD DECK: (empty — no cards loaded)";
  }

  const lines = deck.map((c) => {
    const conf =
      c.confidence != null ? `confidence ${c.confidence}/5` : "unrated";
    const answered = c.myAnswer?.trim() ? "has draft answer" : "no answer yet";
    const pts =
      c.keyPoints?.length > 0
        ? ` · ${c.keyPoints.length} key points`
        : "";
    return `- [${categoryLabel(c.category)}] ${c.question} (${conf}, ${answered}${pts})`;
  });

  return [
    `FLASHCARD DECK (${deck.length} cards — you can propose new cards or avoid duplicates):`,
    ...lines,
  ].join("\n");
}
