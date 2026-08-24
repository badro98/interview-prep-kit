// Parse and execute structured advisor proposals (flashcards, context, stages).

import { CATEGORIES, categoryLabel, getDeck, resolveStageId } from "../flashcards/deck.js";
import { addCustomCards, addCustomContextEntry, getDocOverride, setDocOverride } from "../../lib/store.js";
import { getActiveJob, getActiveJobId, updateJobStages } from "../../lib/jobs.js";
import { saveStageDoc } from "../../lib/generate.js";
import { getStageDoc } from "../prep-docs/stages.js";
import { markdownToHtml } from "../../lib/markdownHtml.js";
import { buildCustomStage } from "../onboarding/steps.js";

const ACTIONS_FENCE = /```advisor-actions[^\n]*\n([\s\S]*?)(?:```|$)/i;
const JSON_PROPOSALS_FENCE = /```json[^\n]*\n([\s\S]*?)(?:```|$)/i;
const PREP_DOC_XML = /<prep-doc\b([^>]*)>([\s\S]*?)<\/prep-doc>/gi;
const PREP_DOC_TICKS = /(`{3,})prep-doc([^\n]*)\n([\s\S]*?)\n\1/gi;

const VALID_CATS = new Set(CATEGORIES.map((c) => c.id));

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Remove machine-readable proposal fences from chat display text. */
export function stripAdvisorActions(text) {
  if (!text) return "";
  return String(text)
    .replace(/```advisor-actions[^\n]*\n[\s\S]*?(?:```|$)/gi, "")
    .replace(/<prep-doc\b[^>]*>[\s\S]*?<\/prep-doc>/gi, "")
    .replace(/(`{3,})prep-doc[^\n]*\n[\s\S]*?\n\1/gi, "")
    .trim();
}

export function hasAdvisorActionsFence(text) {
  const s = String(text || "");
  return (
    /```advisor-actions/i.test(s) ||
    /<prep-doc\b/i.test(s) ||
    /```+prep-doc/i.test(s)
  );
}

function parseJsonPayload(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^json\b/i, "").trim();
  s = s.replace(/,\s*([}\]])/g, "$1");
  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(s.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
  return null;
}

function parsePrepAttrs(raw) {
  const s = String(raw || "");
  const stageId =
    s.match(/stageId\s*=\s*"([^"]+)"/i)?.[1] ||
    s.match(/stage\s*=\s*"([^"]+)"/i)?.[1] ||
    s.match(/^\s+([A-Za-z0-9_-]+)/)?.[1] ||
    null;
  const title = s.match(/title\s*=\s*"([^"]+)"/i)?.[1] || null;
  return { stageId, title };
}

function extractPrepDocs(text) {
  const source = String(text || "");
  const docs = [];
  const xml = new RegExp(PREP_DOC_XML.source, "gi");
  let m;
  while ((m = xml.exec(source))) {
    const markdown = String(m[2] || "").trim();
    if (markdown) docs.push({ ...parsePrepAttrs(m[1]), markdown });
  }
  if (docs.length) return docs;
  const ticks = new RegExp(PREP_DOC_TICKS.source, "gi");
  while ((m = ticks.exec(source))) {
    const markdown = String(m[3] || "").trim();
    if (markdown) docs.push({ ...parsePrepAttrs(m[2]), markdown });
  }
  return docs;
}

function proposalNeedsDoc(p) {
  if (p?.type === "update_prep_doc") {
    return !String(p.markdown || p.content || "").trim();
  }
  if (p?.type === "add_stage") {
    return !String(p.content || p.markdown || "").trim();
  }
  return false;
}

function applyPrepDoc(p, doc) {
  if (p.type === "add_stage") {
    return {
      ...p,
      content: doc.markdown,
      title: (p.title || doc.title || "").trim() || p.title,
    };
  }
  return { ...p, markdown: doc.markdown };
}

function attachPrepDocs(rawProposals, text) {
  const docs = extractPrepDocs(text);
  if (!docs.length) return rawProposals;
  const unused = [...docs];
  return rawProposals.map((p) => {
    if (!proposalNeedsDoc(p)) return p;
    const key = String(p.stageId || p.stage || p.id || p.title || "").toLowerCase();
    const tagged = key
      ? unused.findIndex(
          (d) =>
            String(d.stageId || "").toLowerCase() === key ||
            String(d.title || "").toLowerCase() === key
        )
      : -1;
    const idx = tagged >= 0 ? tagged : unused.findIndex((d) => d.markdown);
    if (idx < 0) return p;
    const [doc] = unused.splice(idx, 1);
    return applyPrepDoc(p, doc);
  });
}

function salvageFromPrepDocs(text) {
  const docs = extractPrepDocs(text);
  if (!docs.length) return [];
  const source = String(text || "");
  const append = /"mode"\s*:\s*"append"/.test(source);
  const jsonStageIds = [...source.matchAll(/"stageId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const jsonTitles = [...source.matchAll(/"title"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const jsonStages = [...source.matchAll(/"stage"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return docs.map((doc, i) => {
    const title = (doc.title || jsonTitles[i] || jsonStages[i] || doc.stageId || jsonStageIds[i] || "Prep doc").trim();
    const stageId = (doc.stageId || jsonStageIds[i] || title).trim();
    return {
      type: "update_prep_doc",
      stageId,
      stage: title,
      title,
      mode: append ? "append" : "replace",
      markdown: doc.markdown,
      content: doc.markdown,
    };
  });
}

function extractRawProposals(source) {
  const chunks = [];
  const actions = source.match(ACTIONS_FENCE);
  if (actions) chunks.push(actions[1]);
  const json = source.match(JSON_PROPOSALS_FENCE);
  if (json && /"proposals"\s*:|"type"\s*:\s*"(?:update_prep_doc|add_stage)"/.test(json[1] || "")) {
    chunks.push(json[1]);
  }
  const bare = source.search(/\{\s*"proposals"\s*:/);
  if (bare >= 0) chunks.push(source.slice(bare));

  for (const chunk of chunks) {
    const payload = parseJsonPayload(chunk);
    if (Array.isArray(payload?.proposals)) return payload.proposals;
  }
  return [];
}

/**
 * Extract proposal objects from an assistant message.
 * @returns {Array<{ id, type, label, ... }>}
 */
export function parseAdvisorActions(text) {
  if (!text) return [];
  const source = String(text);
  let raw = extractRawProposals(source);
  if (!raw.length) raw = salvageFromPrepDocs(source);
  raw = attachPrepDocs(raw, source);
  return raw.map((p, i) => normalizeProposal(p, i)).filter(Boolean);
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
    const title = (p.title || p.stage || "").trim();
    const content = String(p.content || p.markdown || "").trim();
    if (!title || !content) return null;
    const stageId = (p.id || p.stageId || slug(title) || `stage-${index}`).trim();
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

  if (p.type === "update_prep_doc") {
    const stages = getActiveJob()?.stages || [];
    const resolved = resolveStageId(p.stageId || p.stage, stages);
    const markdown = String(p.markdown || p.content || "").trim();
    const mode = p.mode === "append" ? "append" : "replace";
    if (!markdown) return null;
    if (!resolved) {
      const title = String(p.title || p.stage || p.stageId || "").trim();
      if (!title) return null;
      return normalizeProposal(
        {
          type: "add_stage",
          title,
          id: slug(p.stageId || title),
          subtitle: p.subtitle,
          content: markdown,
          label: p.label,
        },
        index
      );
    }
    const title = stages.find((s) => s.id === resolved)?.title || resolved;
    return {
      id: p.id || `prepdoc-${resolved}-${index}`,
      type: "update_prep_doc",
      label:
        p.label ||
        (mode === "append"
          ? `Append to “${title}” prep doc`
          : `Replace prep doc for “${title}”`),
      stageId: resolved,
      mode,
      markdown,
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

  if (proposal.type === "update_prep_doc") {
    return executeUpdatePrepDoc(proposal);
  }

  return { ok: false, message: "Unknown proposal type." };
}

function existingPrepMarkdown(stageId) {
  const override = getDocOverride(stageId);
  if (typeof override?.markdown === "string" && override.markdown.trim()) {
    return override.markdown;
  }
  const stageDoc = getStageDoc(stageId);
  if (!stageDoc?.file) return "";
  const md = String(stageDoc.markdown || "");
  if (md.startsWith("# No prep doc yet")) return "";
  return md;
}

function executeUpdatePrepDoc(proposal) {
  const html = markdownToHtml(proposal.markdown);
  if (proposal.mode === "append") {
    const override = getDocOverride(proposal.stageId);
    const base = existingPrepMarkdown(proposal.stageId);
    const combined = base.trim()
      ? `${base.trim()}\n\n${proposal.markdown}`
      : proposal.markdown;
    const storedHtml =
      typeof override?.html === "string" && override.html.trim()
        ? override.html
        : null;
    setDocOverride(proposal.stageId, combined, {
      html: storedHtml
        ? `${storedHtml}\n${html}`
        : markdownToHtml(combined),
    });
  } else {
    setDocOverride(proposal.stageId, proposal.markdown, { html });
  }
  return {
    ok: true,
    message: proposal.label,
    kind: "prepdoc",
    stageId: proposal.stageId,
  };
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
