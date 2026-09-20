// Parse and execute structured advisor proposals (flashcards, context, stages).

import { CATEGORIES, categoryLabel, getDeck, resolveStageId } from "../flashcards/deck.js";
import {
  addCustomCards,
  addCustomContextEntry,
  addStagePage,
  getDocOverride,
  setCardCategory,
  setCardStage,
  setDocOverride,
  setModelOverride,
} from "../../lib/store.js";
import { getActiveJob, getActiveJobId, updateJobStages } from "../../lib/jobs.js";
import { saveStageDoc } from "../../lib/generate.js";
import { pageDocKey, recordVersionSoon, stageDocKey } from "../../lib/docHistory.js";
import { getStageDoc } from "../prep-docs/stages.js";
import { markdownToHtml, normalizePrepMarkdown } from "../../lib/markdownHtml.js";
import {
  contextRewriteMessage,
  findContextDocumentClone,
  findContextSourceMention,
} from "../../lib/context.js";
import { buildCustomStage } from "../onboarding/steps.js";

const VALID_CATS = new Set(CATEGORIES.map((c) => c.id));

const TYPE_ALIASES = {
  create_stage: "add_stage",
  new_stage: "add_stage",
  add_stages: "add_stage",
  create_prep_doc: "update_prep_doc",
  write_prep_doc: "update_prep_doc",
  add_page: "add_subpage",
  create_subpage: "add_subpage",
};

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function isProposalJson(chunk) {
  return /"proposals"\s*:/.test(String(chunk || ""));
}

/** Remove machine-readable proposal fences from chat display text. */
export function stripAdvisorActions(text) {
  if (!text) return "";
  let s = String(text)
    .replace(/```advisor-actions[^\n]*\n[\s\S]*?(?:```|$)/gi, "")
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/gi, (block) =>
      isProposalJson(block) ? "" : block
    )
    .replace(/<prep-doc\b[^>]*>[\s\S]*?(?:<\/prep-doc>|$)/gi, "")
    .replace(/(`{3,})prep-doc[^\n]*\n[\s\S]*?(?:\n\1|$)/gi, "");
  const bare = s.search(/\{\s*"proposals"\s*:/);
  if (bare >= 0) s = s.slice(0, bare);
  return s.trim();
}

export function hasAdvisorActionsFence(text) {
  const s = String(text || "");
  return (
    /```advisor-actions/i.test(s) ||
    /<prep-doc\b/i.test(s) ||
    /&lt;prep-doc\b/i.test(s) ||
    /```+prep-doc/i.test(s) ||
    ( /```json/i.test(s) && isProposalJson(s) ) ||
    /\{\s*"proposals"\s*:/.test(s)
  );
}

function stripTrailingCommas(value) {
  return String(value || "").replace(/,\s*([}\]])/g, "$1");
}

/** First top-level `{...}` starting at `from`, treating raw newlines as inside strings. */
function sliceJsonObject(s, from = 0) {
  const start = String(s || "").indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Allow raw newlines/tabs inside JSON strings (models stuffing markdown into JSON). */
function repairJsonStrings(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === "\n" || c === "\r") {
        out += "\\n";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
      if (c.charCodeAt(0) < 32) continue;
      out += c;
      continue;
    }
    if (c === '"') inString = true;
    out += c;
  }
  return out;
}

function parseJsonPayload(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^json\b/i, "").trim();
  const tryParse = (value) => {
    if (!value) return null;
    const cleaned = stripTrailingCommas(value);
    try {
      return JSON.parse(cleaned);
    } catch {
      try {
        return JSON.parse(repairJsonStrings(cleaned));
      } catch {
        return null;
      }
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const sliced = sliceJsonObject(s);
  if (sliced) return tryParse(sliced);
  return null;
}

function attrValue(raw, name) {
  const s = String(raw || "");
  return (
    s.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, "i"))?.[1] ||
    s.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`, "i"))?.[1] ||
    s.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1] ||
    null
  );
}

function parsePrepAttrs(raw) {
  const s = String(raw || "");
  const stageId =
    attrValue(s, "stageId") ||
    attrValue(s, "stage") ||
    s.match(/^\s+([A-Za-z0-9_-]+)/)?.[1] ||
    null;
  const title = attrValue(s, "title");
  return { stageId, title };
}

function decodePrepDocEntities(s) {
  const source = String(s || "");
  if (!/&lt;\s*prep-doc/i.test(source)) return source;
  return source.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function extractXmlPrepDocs(source) {
  const docs = [];
  const re = /<prep-doc\b([^>]*)>/gi;
  const tags = [];
  let m;
  while ((m = re.exec(source))) {
    tags.push({ attrs: m[1], bodyStart: m.index + m[0].length, openStart: m.index });
  }
  for (let i = 0; i < tags.length; i++) {
    const until = i + 1 < tags.length ? tags[i + 1].openStart : source.length;
    const region = source.slice(tags[i].bodyStart, until);
    const close = region.search(/<\/prep-doc>/i);
    const body = close >= 0 ? region.slice(0, close) : region;
    const markdown = normalizePrepMarkdown(body);
    if (!markdown) continue;
    const attrs = parsePrepAttrs(tags[i].attrs);
    // Ignore bare "<prep-doc>" mentions in prose (no attrs, no heading).
    if (!attrs.stageId && !attrs.title && !/^#\s+/m.test(markdown) && markdown.length < 80) {
      continue;
    }
    docs.push({ ...attrs, markdown });
  }
  return docs;
}

function extractTickPrepDocs(source) {
  const docs = [];
  const re = /(`{3,})prep-doc([^\n]*)\n/gi;
  const tags = [];
  let m;
  while ((m = re.exec(source))) {
    tags.push({
      ticks: m[1],
      attrs: m[2],
      bodyStart: m.index + m[0].length,
      openStart: m.index,
    });
  }
  for (let i = 0; i < tags.length; i++) {
    const until = i + 1 < tags.length ? tags[i + 1].openStart : source.length;
    const region = source.slice(tags[i].bodyStart, until);
    const closer = region.indexOf(`\n${tags[i].ticks}`);
    const body = closer >= 0 ? region.slice(0, closer) : region.replace(new RegExp(`${tags[i].ticks}\\s*$`), "");
    const markdown = normalizePrepMarkdown(body);
    if (markdown) docs.push({ ...parsePrepAttrs(tags[i].attrs), markdown });
  }
  return docs;
}

function extractMarkdownFenceDocs(source) {
  const docs = [];
  const re = /```(?:markdown|md|text)\b[^\n]*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(source))) {
    const markdown = normalizePrepMarkdown(m[1]);
    if (!markdown) continue;
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
    docs.push({ stageId: title ? slug(title) : null, title, markdown });
  }
  return docs;
}

function extractPrepDocs(text) {
  const source = decodePrepDocEntities(text);
  const xml = extractXmlPrepDocs(source);
  if (xml.length) return xml;
  return extractTickPrepDocs(source);
}

function canonicalType(type) {
  const t = String(type || "");
  return TYPE_ALIASES[t] || t;
}

function canonicalizeProposal(p) {
  if (!p || typeof p !== "object") return p;
  const type = canonicalType(p.type);
  return type === p.type ? p : { ...p, type };
}

function proposalNeedsDoc(p) {
  if (p?.type === "update_prep_doc" || p?.type === "add_subpage" || p?.type === "add_page") {
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
  if (p.type === "add_subpage" || p.type === "add_page") {
    return {
      ...p,
      type: "add_subpage",
      markdown: doc.markdown,
      title: (p.title || doc.title || "").trim() || p.title,
      stageId: p.stageId || doc.stageId,
    };
  }
  return { ...p, markdown: doc.markdown };
}

function attachNamedDocs(rawProposals, docs) {
  if (!docs.length) return rawProposals;
  const unused = [...docs];
  return rawProposals.map((p) => {
    if (!proposalNeedsDoc(p)) return p;
    const titleKey = String(p.title || p.name || "").toLowerCase();
    const stageKey = String(p.stageId || p.stage || p.id || "").toLowerCase();
    let idx = -1;
    if (titleKey) {
      idx = unused.findIndex((d) => {
        const dt = String(d.title || "").toLowerCase();
        const ds = String(d.stageId || "").toLowerCase();
        return dt === titleKey && (!stageKey || !ds || ds === stageKey);
      });
    }
    if (idx < 0 && stageKey) {
      idx = unused.findIndex(
        (d) =>
          String(d.stageId || "").toLowerCase() === stageKey ||
          String(d.title || "").toLowerCase() === stageKey
      );
    }
    if (idx < 0) idx = unused.findIndex((d) => d.markdown);
    if (idx < 0) return p;
    const [doc] = unused.splice(idx, 1);
    return applyPrepDoc(p, doc);
  });
}

function attachPrepDocs(rawProposals, text) {
  return attachNamedDocs(rawProposals, extractPrepDocs(text));
}

function salvageFromPrepDocs(text) {
  const source = String(text || "");
  let docs = extractPrepDocs(source);
  if (!docs.length) docs = extractMarkdownFenceDocs(source);
  if (!docs.length) return [];
  const append = /"mode"\s*:\s*"append"/.test(source);
  const jsonTypes = [...source.matchAll(/"type"\s*:\s*"([^"]+)"/g)].map((m) =>
    canonicalType(m[1])
  );
  const jsonStageIds = [...source.matchAll(/"stageId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const jsonTitles = [...source.matchAll(/"title"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const jsonStages = [...source.matchAll(/"stage"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return docs.map((doc, i) => {
    const title = (doc.title || jsonTitles[i] || jsonStages[i] || doc.stageId || jsonStageIds[i] || "Prep doc").trim();
    const stageId = (doc.stageId || jsonStageIds[i] || title).trim();
    const type = jsonTypes[i];
    if (type === "add_subpage") {
      return {
        type: "add_subpage",
        stageId,
        title,
        markdown: doc.markdown,
        content: doc.markdown,
      };
    }
    if (type === "add_stage") {
      return {
        type: "add_stage",
        id: stageId,
        stageId,
        title,
        content: doc.markdown,
        markdown: doc.markdown,
      };
    }
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

function unescapeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return String(raw || "").replace(/\\"/g, '"');
  }
}

function salvageFromFlashcardUpdates(source) {
  const s = String(source || "");
  if (!/"question"\s*:/.test(s) || !/"stageId"\s*:/.test(s)) return [];
  if (
    !/"type"\s*:\s*"(?:update_flashcards|assign_flashcards|add_flashcards)"/.test(s) &&
    !/"updates"\s*:\s*\[/.test(s)
  ) {
    return [];
  }
  const questions = [];
  const qRe = /"question"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = qRe.exec(s))) {
    questions.push({
      question: unescapeJsonString(m[1]),
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  const updates = [];
  for (let i = 0; i < questions.length; i++) {
    const beforeStart = i === 0 ? 0 : questions[i - 1].end;
    const before = s.slice(beforeStart, questions[i].index);
    const after = s.slice(
      questions[i].end,
      i + 1 < questions.length ? questions[i + 1].index : s.length
    );
    const stageMatch =
      after.match(/"stageId"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      after.match(/"stage"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      before.match(/"stageId"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      before.match(/"stage"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!stageMatch) continue;
    updates.push({
      question: questions[i].question,
      stageId: unescapeJsonString(stageMatch[1]),
    });
  }
  if (!updates.length) return [];
  return [{ type: "update_flashcards", updates }];
}

function extractRawProposals(source) {
  const chunks = [];
  const fenceRe = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let m;
  while ((m = fenceRe.exec(source))) {
    const lang = m[1] || "";
    const body = m[2];
    if (/advisor-actions/i.test(lang) || isProposalJson(body)) chunks.push(body);
  }
  const bare = source.search(/\{\s*"proposals"\s*:/);
  if (bare >= 0) chunks.push(source.slice(bare));

  for (const chunk of chunks) {
    const payload = parseJsonPayload(chunk);
    if (Array.isArray(payload?.proposals)) return payload.proposals;
  }
  return salvageFromFlashcardUpdates(source);
}

/**
 * Extract proposal objects from an assistant message.
 * @returns {Array<{ id, type, label, ... }>}
 */
export function parseAdvisorActions(text) {
  if (!text) return [];
  const source = String(text);
  let raw = extractRawProposals(source)
    .map(canonicalizeProposal)
    .filter((p) => p && p.type);
  if (!raw.length) raw = salvageFromPrepDocs(source);
  raw = attachPrepDocs(raw, source);
  if (raw.some(proposalNeedsDoc)) {
    raw = attachNamedDocs(raw, extractMarkdownFenceDocs(source));
  }
  return raw.map((p, i) => normalizeProposal(p, i)).filter(Boolean);
}

function normalizeQuestion(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/g, "")
    .trim();
}

function matchDeckCard(query, deck, usedIds) {
  const id = String(query.id || query.cardId || "").trim();
  if (id) {
    const byId = deck.find((c) => c.id === id && !usedIds.has(c.id));
    if (byId) return byId;
  }
  const q = normalizeQuestion(query.question);
  if (!q) return null;
  const unused = deck.filter((c) => !usedIds.has(c.id));
  const exact = unused.find((c) => normalizeQuestion(c.question) === q);
  if (exact) return exact;
  const prefixes = unused.filter((c) => {
    const cq = normalizeQuestion(c.question);
    return cq.startsWith(q) || q.startsWith(cq);
  });
  if (prefixes.length === 1) return prefixes[0];
  const startsWithQuery = prefixes.filter((c) =>
    normalizeQuestion(c.question).startsWith(q)
  );
  return startsWithQuery.length === 1 ? startsWithQuery[0] : null;
}

function resolveAssignStage(raw, stages) {
  if (raw == null || String(raw).trim() === "") return undefined;
  const value = String(raw).trim();
  if (/^unassigned$/i.test(value)) return "";
  return resolveStageId(value, stages);
}

function normalizeUpdateFlashcards(p, index) {
  const stages = getActiveJob()?.stages || [];
  const deck = getDeck();
  const usedIds = new Set();
  const rows = Array.isArray(p.updates) ? p.updates : Array.isArray(p.cards) ? p.cards : [];
  const updates = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rawStage = row.stageId ?? row.stage;
    const hasStage = rawStage != null && String(rawStage).trim() !== "";
    const stageId = hasStage ? resolveAssignStage(rawStage, stages) : undefined;
    if (hasStage && stageId === null) {
      // Unknown stage id — keep the card for answer/category updates.
    }
    const card = matchDeckCard(row, deck, usedIds);
    if (!card) continue;
    usedIds.add(card.id);
    const category = VALID_CATS.has(row.category) ? row.category : undefined;
    const referenceAnswer =
      typeof row.referenceAnswer === "string" ? row.referenceAnswer.trim() : "";
    const keyPoints = Array.isArray(row.keyPoints)
      ? row.keyPoints.filter(Boolean).map(String)
      : [];
    const nextStage =
      !hasStage || stageId === null || stageId === undefined
        ? card.stageId || null
        : stageId || null;
    const stageChanged =
      hasStage && stageId !== null && stageId !== undefined && nextStage !== (card.stageId || null);
    updates.push({
      id: card.id,
      question: card.question,
      stageId: nextStage,
      fromStageId: card.stageId || null,
      stageChanged,
      category: category || card.category,
      fromCategory: card.category,
      categoryChanged: !!category && category !== card.category,
      referenceAnswer,
      keyPoints,
    });
  }
  if (!updates.length) return null;
  const n = updates.length;
  return {
    id: p.id || `update-flashcards-${index}`,
    type: "update_flashcards",
    label: p.label || `Update ${n} flashcard${n === 1 ? "" : "s"}`,
    updates,
  };
}

function blockedForContextRewrite(p, markdown) {
  const clone = findContextDocumentClone(
    markdown,
    `${p.label || ""} ${p.title || ""} ${p.name || ""} ${p.stage || ""} ${p.stageId || ""}`
  );
  return clone ? contextRewriteMessage(clone) : undefined;
}

function normalizeProposal(p, index) {
  if (!p || !p.type) return null;
  p = canonicalizeProposal(p);
  if (!p.type) return null;

  if (p.type === "add_flashcards") {
    const stages = getActiveJob()?.stages || [];
    const cards = (p.cards || [])
      .filter((c) => c && typeof c.question === "string" && c.question.trim())
      .map((c, cardIndex) => {
        const stageId = resolveStageId(c.stageId || c.stage, stages);
        const givenId = typeof c.id === "string" ? c.id.trim() : "";
        return {
          // Stable across re-parses so Confirm status (Added/Skipped) survives
          // re-renders and thread switches. Unique ids are minted at execute if needed.
          id: givenId || `adv-${cardIndex}-${slug(c.question)}`,
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

  if (p.type === "update_flashcards" || p.type === "assign_flashcards") {
    return normalizeUpdateFlashcards(p, index);
  }

  if (p.type === "add_context") {
    const name = (p.name || "").trim();
    const content = (p.content || "").trim();
    if (!name || !content) return null;
    const existing = findContextSourceMention(name);
    const blockedReason =
      existing?.source === "profile"
        ? contextRewriteMessage(existing)
        : undefined;
    return {
      id: p.id || `context-${index}`,
      type: "add_context",
      label: p.label || `Save “${name}” to context`,
      name,
      content,
      sourceUrl: p.sourceUrl || null,
      ...(blockedReason ? { blockedReason } : {}),
    };
  }

  if (p.type === "add_stage") {
    const title = (p.title || p.stage || "").trim();
    const content = normalizePrepMarkdown(p.content || p.markdown || "");
    if (!title || !content) return null;
    const stageId = (p.id || p.stageId || slug(title) || `stage-${index}`).trim();
    if (!stageId) return null;
    const blockedReason = blockedForContextRewrite(p, content);
    return {
      id: p.proposalId || `stage-${stageId}-${index}`,
      type: "add_stage",
      label: p.label || `Add stage “${title}” + prep doc`,
      stageId,
      title,
      subtitle: (p.subtitle || "").trim(),
      content,
      regenTask: typeof p.regenTask === "string" ? p.regenTask.trim() : "",
      ...(blockedReason ? { blockedReason } : {}),
    };
  }

  if (p.type === "add_subpage" || p.type === "add_page") {
    const stages = getActiveJob()?.stages || [];
    const resolved = resolveStageId(p.stageId || p.stage, stages);
    const title = (p.title || p.name || "").trim();
    const markdown = normalizePrepMarkdown(p.markdown || p.content || "");
    if (!resolved || !title || !markdown) return null;
    const stageName = stages.find((s) => s.id === resolved)?.title || resolved;
    const blockedReason = blockedForContextRewrite(p, markdown);
    return {
      id: p.id || `subpage-${resolved}-${index}`,
      type: "add_subpage",
      label: p.label || `Add subpage “${title}” to ${stageName}`,
      stageId: resolved,
      title,
      markdown,
      ...(blockedReason ? { blockedReason } : {}),
    };
  }

  if (p.type === "update_prep_doc") {
    const stages = getActiveJob()?.stages || [];
    const resolved = resolveStageId(p.stageId || p.stage, stages);
    const markdown = normalizePrepMarkdown(p.markdown || p.content || "");
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
    const blockedReason = blockedForContextRewrite(p, markdown);
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
      ...(blockedReason ? { blockedReason } : {}),
    };
  }

  return null;
}

/** Apply a confirmed proposal. Returns a short result message. */
export function executeAdvisorProposal(proposal) {
  if (!proposal) return { ok: false, message: "Nothing to apply." };
  if (proposal.blockedReason) {
    return { ok: false, message: proposal.blockedReason };
  }

  if (proposal.type === "add_flashcards") {
    const deck = getDeck();
    const existingByQ = new Map(
      deck.map((c) => [c.question.toLowerCase().trim(), c])
    );
    const novel = [];
    let reassigned = 0;
    const usedIds = new Set(deck.map((c) => c.id));
    for (const c of proposal.cards) {
      const existing = existingByQ.get(c.question.toLowerCase().trim());
      if (existing) {
        if (c.stageId && c.stageId !== existing.stageId) {
          setCardStage(existing.id, c.stageId);
          reassigned += 1;
        }
        if (c.referenceAnswer || c.keyPoints?.length) {
          setModelOverride(existing.id, {
            referenceAnswer: c.referenceAnswer || existing.referenceAnswer,
            keyPoints: c.keyPoints?.length ? c.keyPoints : existing.keyPoints,
          });
        }
      } else {
        let id = c.id;
        if (!id || usedIds.has(id)) {
          id = `adv-${slug(c.question)}-${Math.random().toString(36).slice(2, 7)}`;
        }
        usedIds.add(id);
        novel.push({ ...c, id });
      }
    }
    const added = addCustomCards(novel);
    const parts = [];
    if (added > 0) parts.push(`Added ${added} card${added === 1 ? "" : "s"} to your flashcard deck.`);
    if (reassigned > 0) {
      parts.push(
        `Assigned ${reassigned} existing card${reassigned === 1 ? "" : "s"} to a stage.`
      );
    }
    const skipped = proposal.cards.length - novel.length - reassigned;
    if (!parts.length) parts.push("No new cards added.");
    if (skipped > 0) {
      parts.push(
        `(${skipped} duplicate question${skipped === 1 ? "" : "s"} skipped.)`
      );
    }
    return {
      ok: added > 0 || reassigned > 0,
      message: parts.join(" "),
      kind: "flashcards",
      count: added,
    };
  }

  if (proposal.type === "update_flashcards") {
    let stages = 0;
    let answers = 0;
    let categories = 0;
    for (const row of proposal.updates || []) {
      if (!row?.id) continue;
      if (row.stageChanged) {
        setCardStage(row.id, row.stageId || null);
        stages += 1;
      }
      if (row.categoryChanged && row.category) {
        setCardCategory(row.id, row.category);
        categories += 1;
      }
      if (row.referenceAnswer || row.keyPoints?.length) {
        setModelOverride(row.id, {
          referenceAnswer: row.referenceAnswer || "",
          keyPoints: row.keyPoints || [],
        });
        answers += 1;
      }
    }
    const applied = stages + answers + categories;
    const bits = [];
    if (stages) bits.push(`stage on ${stages}`);
    if (categories) bits.push(`category on ${categories}`);
    if (answers) bits.push(`model answer on ${answers}`);
    return {
      ok: applied > 0,
      message: applied > 0 ? `Updated ${bits.join(", ")}.` : "No flashcards were updated.",
      kind: "flashcards",
      count: applied,
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

  if (proposal.type === "add_subpage") {
    return executeAddSubpage(proposal);
  }

  if (proposal.type === "update_prep_doc") {
    return executeUpdatePrepDoc(proposal);
  }

  return { ok: false, message: "Unknown proposal type." };
}

function executeAddSubpage(proposal) {
  const blocked =
    proposal.blockedReason ||
    blockedForContextRewrite(proposal, proposal.markdown);
  if (blocked) return { ok: false, message: blocked };
  const page = addStagePage(proposal.stageId, {
    title: proposal.title,
    html: markdownToHtml(proposal.markdown),
  });
  recordVersionSoon({
    docKey: pageDocKey(proposal.stageId, page.id),
    source: "advisor",
    html: page.html,
    markdown: proposal.markdown,
  });
  return {
    ok: true,
    message: proposal.label,
    kind: "subpage",
    stageId: proposal.stageId,
    pageId: page.id,
  };
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
  const blocked =
    proposal.blockedReason ||
    blockedForContextRewrite(proposal, proposal.markdown);
  if (blocked) return { ok: false, message: blocked };
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
    recordVersionSoon({
      docKey: stageDocKey(proposal.stageId),
      source: "advisor",
      html: storedHtml ? `${storedHtml}\n${html}` : markdownToHtml(combined),
      markdown: combined,
    });
  } else {
    setDocOverride(proposal.stageId, proposal.markdown, { html });
    recordVersionSoon({
      docKey: stageDocKey(proposal.stageId),
      source: "advisor",
      html,
      markdown: proposal.markdown,
    });
  }
  return {
    ok: true,
    message: proposal.label,
    kind: "prepdoc",
    stageId: proposal.stageId,
  };
}

function executeAddStage(proposal) {
  const blocked =
    proposal.blockedReason ||
    blockedForContextRewrite(proposal, proposal.content);
  if (blocked) return { ok: false, message: blocked };
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
    saveStageDoc(proposal.stageId, proposal.content, { source: "advisor" });
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
  saveStageDoc(stage.id, proposal.content, { source: "advisor" });
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
