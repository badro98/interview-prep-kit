// Suggested next stages — seed stages not yet on the active job, surfaced when
// *newly saved* context implies a concrete next step (e.g. a recruiter transcript
// that names the rest of the loop). Ambient context and missing seed stages
// alone are not enough to toast.

import { STAGES as SEED_STAGES } from "../../../interview.config.js";
import { getActiveContextBlocks } from "../../lib/context.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getDismissedSuggestions } from "../../lib/store.js";

const SEED_DOCS = import.meta.glob("../../../generated/prep-*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const STAGE_HINTS = [
  { id: "recruiter", re: /\brecruiter screen\b|\brecruiter call\b|\bintro call\b/i },
  { id: "hm", re: /\bhiring manager\b|\bhm round\b|\bhm interview\b|\bhm screen\b/i },
  { id: "takehome", re: /\btake[- ]?home\b|\bpractical exercise\b|\bwork sample\b/i },
  { id: "onsite", re: /\bon-?site\b|\bpanel interview\b|\bonsite loop\b|\bvirtual onsite\b/i },
  { id: "final", re: /\bfinal round\b|\bfinals with\b|\bexec round\b/i },
];

const UPCOMING_LOOP_RE =
  /\bnext (up|step|steps|round|rounds|will|is|are)\b|\byou('ll| will) (meet|speak|interview|have|talk)\b|\bloop (is|includes|will)\b|\bscheduled (a|the|your)\b|\bfollowing (this|the) (call|screen|chat|conversation)\b|\bafter (this|the) (call|screen)\b|\bthen (a|the|you('ll| will))\b/i;

const RESUME_NAME_RE = /resume|\bcv\b|curriculum vitae/i;
const JD_NAME_RE = /\bjob description\b|\bjob posting\b|\bjd\b|\brole posting\b/i;
const PIPELINE_NAME_RE =
  /transcript|recruiter|call notes|debrief|pipeline|screen notes|loop notes/i;

function loadSeedDoc(fileName) {
  if (!fileName) return "";
  const match = Object.entries(SEED_DOCS).find(([path]) => path.endsWith(fileName));
  return match ? String(match[1]) : "";
}

function shortTitle(stage) {
  return String(stage?.title || "").replace(/\s*—.*$/, "").trim();
}

function seedById(id) {
  return SEED_STAGES.find((s) => s.id === id) || null;
}

function hasUpcomingLoopLanguage(text) {
  return UPCOMING_LOOP_RE.test(String(text || ""));
}

function looksLikeResumeBody(content) {
  const c = String(content || "").toLowerCase();
  if (!c.trim()) return false;
  const hits = ["experience", "education", "skills", "work history", "employment"].filter((w) =>
    c.includes(w)
  ).length;
  return hits >= 2 && !hasUpcomingLoopLanguage(c);
}

/**
 * Classify a single source so resume/JD dumps don't look like pipeline intel.
 * @param {{name?: string, label?: string, content?: string}} entry
 */
export function classifyContextKind(entry = {}) {
  const name = String(entry.name || entry.label || "");
  const content = String(entry.content || "");
  if (RESUME_NAME_RE.test(name) || looksLikeResumeBody(content)) return "resume";
  if (JD_NAME_RE.test(name)) return "jd";
  if (PIPELINE_NAME_RE.test(name) || hasUpcomingLoopLanguage(content)) return "pipeline";
  return "other";
}

/** Stage ids mentioned in a blob of new context. */
export function detectMentionedStageIds(text) {
  const blob = String(text || "");
  const ids = [];
  for (const hint of STAGE_HINTS) {
    if (hint.re.test(blob) && !ids.includes(hint.id)) ids.push(hint.id);
  }
  return ids;
}

/**
 * Heuristic over provided blocks (or all active context if omitted).
 * Transcript-like = label/intel, not "the file is long".
 */
export function detectPipelineContextSignal(blocks) {
  const source = (blocks || getActiveContextBlocks()).filter((b) => b.enabled !== false && b.content?.trim());
  const blob = source.map((b) => `${b.label || b.name || ""}\n${b.content}`).join("\n");
  const kinds = source.map((b) => classifyContextKind({ name: b.label || b.name, content: b.content }));
  const pipelineBlocks = source.filter((_, i) => kinds[i] === "pipeline");
  const pipelineBlob = pipelineBlocks.map((b) => `${b.label || b.name || ""}\n${b.content}`).join("\n");

  const hasRecruiter = /\brecruiter\b/i.test(pipelineBlob);
  const mentioned = detectMentionedStageIds(pipelineBlob || blob);
  const hasPipelinePeople = mentioned.length > 0;
  const transcriptLike = pipelineBlocks.length > 0;

  return {
    hasRecruiter,
    hasPipelinePeople,
    transcriptLike,
    mentionedStageIds: mentioned,
    shouldSuggest: transcriptLike && (hasRecruiter || hasPipelinePeople),
    blocks: source,
  };
}

function titleList(ids) {
  return ids
    .map((id) => shortTitle(seedById(id)))
    .filter(Boolean);
}

function joinTitles(titles) {
  if (titles.length <= 1) return titles[0] || "";
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;
}

/**
 * Build a toast-worthy recommendation from entries the user just saved.
 * Returns null when there's nothing actionable (resume, generic notes, etc.).
 *
 * @param {Array<{name?: string, label?: string, content?: string}>} entries
 * @param {{existingStageIds?: string[], dismissedIds?: string[], currentStageId?: string|null}} [opts]
 */
export function recommendFromNewContext(entries, opts = {}) {
  const list = (entries || []).filter((e) => String(e.content || "").trim() || String(e.name || e.label || "").trim());
  if (!list.length) return null;

  const existing = new Set(opts.existingStageIds || []);
  const dismissed = new Set(opts.dismissedIds || []);
  const currentStageId = opts.currentStageId || null;
  const labels = list.map((e) => e.name || e.label || "Untitled").filter(Boolean);

  const classified = list.map((e) => ({ entry: e, kind: classifyContextKind(e) }));
  const pipeline = classified.filter((c) => c.kind === "pipeline");
  const jds = classified.filter((c) => c.kind === "jd");

  if (pipeline.length) {
    const blob = pipeline.map((c) => String(c.entry.content || "")).join("\n");
    const mentioned = detectMentionedStageIds(blob);
    const missing = mentioned.filter((id) => !existing.has(id) && !dismissed.has(id));
    if (missing.length) {
      const titles = titleList(missing);
      const primary = titles[0] || "next stage";
      return {
        kind: "add_stages",
        stageIds: missing,
        sourceLabels: labels,
        eyebrow: "New context",
        title: missing.length === 1 ? `${primary} is next` : "Next rounds mentioned",
        body:
          missing.length === 1
            ? `${labels[0] || "Your new notes"} mention a ${primary.toLowerCase()} round. Add it to this job?`
            : `${labels[0] || "Your new notes"} mention ${joinTitles(titles)}. Add them to this job?`,
        actionLabel: missing.length === 1 ? `Add ${primary}` : `Add ${missing.length} stages`,
      };
    }

    const alreadyOnJob = mentioned.filter((id) => existing.has(id));
    const refreshId = alreadyOnJob[0] || (existing.has(currentStageId) ? currentStageId : null);
    if (refreshId) {
      const title = shortTitle(seedById(refreshId)) || "prep doc";
      return {
        kind: "refresh_docs",
        stageIds: [refreshId],
        sourceLabels: labels,
        eyebrow: "New context",
        title: `Update ${title} from this intel?`,
        body: `${labels[0] || "Your new notes"} looks like pipeline intel. Refresh the ${title} prep doc so it uses them.`,
        actionLabel: `Refresh ${title}`,
      };
    }
    return null;
  }

  if (jds.length) {
    const refreshId =
      (currentStageId && existing.has(currentStageId) && currentStageId) ||
      (existing.has("recruiter") ? "recruiter" : [...existing][0] || null);
    if (!refreshId) return null;
    const title = shortTitle(seedById(refreshId)) || "prep doc";
    return {
      kind: "refresh_docs",
      stageIds: [refreshId],
      sourceLabels: labels,
      eyebrow: "New context",
      title: "Job description saved",
      body: `Refresh ${title} so it tracks this posting?`,
      actionLabel: `Refresh ${title}`,
    };
  }

  return null;
}

/**
 * Seed stages the job doesn't already have (and the user hasn't dismissed).
 * @param {{ids?: string[]}} [opts] — when set, only those seed ids (still excluding existing/dismissed).
 * @returns {Array<{id,title,subtitle,file?,regenTask?,markdown,source:'seed'}>}
 */
export function getSuggestedStages(opts = {}) {
  const job = getActiveJob();
  if (!job) return [];
  const existing = new Set((job.stages || []).map((s) => s.id));
  const dismissed = new Set(getDismissedSuggestions());
  const only = opts.ids ? new Set(opts.ids) : null;

  return SEED_STAGES.filter((s) => {
    if (existing.has(s.id) || dismissed.has(s.id)) return false;
    if (only && !only.has(s.id)) return false;
    return true;
  }).map((s) => ({
    ...s,
    markdown:
      loadSeedDoc(s.file) ||
      `# ${s.title}\n\nPrep doc will generate from your context when you add this stage.`,
    source: "seed",
  }));
}

/**
 * Banner copy for a stored recommendation. Suggestions are used only as a
 * fallback title list when the recommendation didn't include copy.
 */
export function buildSuggestionBanner(recommendation, suggestions) {
  if (recommendation?.title) {
    return {
      eyebrow: recommendation.eyebrow || "New context",
      title: recommendation.title,
      body: recommendation.body || "",
      actionLabel: recommendation.actionLabel || null,
      kind: recommendation.kind || null,
    };
  }
  if (!suggestions?.length) return null;
  const titles = suggestions.slice(0, 3).map((s) => shortTitle(s));
  return {
    eyebrow: "Suggested stages",
    title: titles.length === 1 ? `${titles[0]} is ready to add` : "A few stages are ready to add",
    body: `Review ${joinTitles(titles)}, then add if it looks right.`,
    actionLabel: titles.length === 1 ? `Add ${titles[0]}` : `Add ${titles.length} stages`,
    kind: "add_stages",
  };
}

/** True when we should auto-surface the suggestion banner/cards. */
export function shouldShowSuggestions(recommendation, suggestions) {
  if (recommendation?.kind === "refresh_docs" && recommendation.stageIds?.length) return true;
  if (recommendation?.kind === "add_stages" && suggestions?.length) return true;
  return false;
}
