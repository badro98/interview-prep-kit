// Parse and execute structured advisor proposals (flashcards, context, stages).

import { CATEGORIES, categoryLabel, getDeck, resolveStageId } from "../flashcards/deck.js";
import { addCustomCards, addCustomContextEntry } from "../../lib/store.js";
import { getActiveJob, getActiveJobId, updateJobStages } from "../../lib/jobs.js";
import { saveStageDoc } from "../../lib/generate.js";
import { buildCustomStage } from "../onboarding/steps.js";

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
    const stages = getActiveJob()?.stages || [];
    const cards = (p.cards || [])
      .filter((c) => c && typeof c.question === "string" && c.question.trim())
      .map((c) => {
        const stageId = resolveStageId(c.stageId || c.stage, stages);
        return {
          id: `adv-${slug(c.question)}-${Math.random().toString(36).slice(2, 7)}`,
          category: VALID_CATS.has(c.category) ? c.category : "behavioral",
          question: c.question.trim(),
          referenceAnswer: (c.referenceAnswer || "").trim(),
          keyPoints: Array.isArray(c.keyPoints)
            ? c.keyPoints.filter(Boolean).map(String)
            : [],
          ...(stageId ? { stageId } : {}),
        };
      });
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

  if (p.type === "add_stage") {
    const title = (p.title || "").trim();
    const content = (p.content || "").trim();
    if (!title || !content) return null;
    const stageId = (p.id || slug(title) || `stage-${index}`).trim();
    if (!stageId) return null;
    return {
      id: p.proposalId || `stage-${stageId}-${index}`,
      type: "add_stage",
      label: p.label || `Add stage “${title}” + prep doc`,
      stageId,
      title,
      subtitle: (p.subtitle || "").trim(),
      content,
      regenTask: typeof p.regenTask === "string" ? p.regenTask.trim() : "",
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

  if (proposal.type === "add_stage") {
    return executeAddStage(proposal);
  }

  return { ok: false, message: "Unknown proposal type." };
}

function executeAddStage(proposal) {
  const job = getActiveJob();
  const jobId = getActiveJobId();
  if (!job || !jobId) {
    return { ok: false, message: "No active job — finish onboarding first." };
  }

  const existing = job.stages.find((s) => s.id === proposal.stageId);
  if (existing) {
    const nextStages = job.stages.map((s) =>
      s.id === proposal.stageId
        ? {
            ...s,
            title: proposal.title || s.title,
            subtitle: proposal.subtitle || s.subtitle,
            ...(proposal.regenTask ? { regenTask: proposal.regenTask } : {}),
          }
        : s
    );
    updateJobStages(jobId, nextStages);
    saveStageDoc(proposal.stageId, proposal.content);
    return {
      ok: true,
      message: `Updated prep doc for “${proposal.title}”. Open Prep Docs to review.`,
      kind: "stage",
      stageId: proposal.stageId,
      updated: true,
    };
  }

  const base = buildCustomStage(proposal.title);
  const stage = {
    ...base,
    id: proposal.stageId,
    title: proposal.title,
    subtitle: proposal.subtitle || "",
    ...(proposal.regenTask
      ? { regenTask: proposal.regenTask }
      : { regenTask: base.regenTask }),
  };
  updateJobStages(jobId, [...job.stages, stage]);
  saveStageDoc(stage.id, proposal.content);
  return {
    ok: true,
    message: `Added stage “${stage.title}” with prep doc. Open Prep Docs to review.`,
    kind: "stage",
    stageId: stage.id,
    updated: false,
  };
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
    const stageTag = c.stageId ? ` · stage ${c.stageId}` : "";
    return `- [${categoryLabel(c.category)}${stageTag}] ${c.question} (${conf}, ${answered}${pts})`;
  });

  return [
    `FLASHCARD DECK (${deck.length} cards — you can propose new cards or avoid duplicates):`,
    ...lines,
  ].join("\n");
}
