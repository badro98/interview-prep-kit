// Suggested next stages — seed stages not yet on the active job, surfaced when
// context looks like new pipeline intel (e.g. a recruiter call transcript).

import { APP, STAGES as SEED_STAGES } from "../../../interview.config.js";
import { getActiveContextBlocks } from "../../lib/context.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getDismissedSuggestions } from "../../lib/store.js";

const SEED_DOCS = import.meta.glob("../../../generated/prep-*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function loadSeedDoc(fileName) {
  if (!fileName) return "";
  const match = Object.entries(SEED_DOCS).find(([path]) => path.endsWith(fileName));
  return match ? String(match[1]) : "";
}

/** Heuristic: active context mentions recruiter / pipeline / interviewers. */
export function detectPipelineContextSignal() {
  const blocks = getActiveContextBlocks().filter((b) => b.enabled && b.content?.trim());
  const blob = blocks.map((b) => `${b.label}\n${b.content}`).join("\n").toLowerCase();

  const hasRecruiter =
    /\brecruiter\b/.test(blob) ||
    /\brecruiter call\b/.test(blob) ||
    /\bscreen\b/.test(blob) && /\b(call|interview)\b/.test(blob);
  // Detect stage *shapes* in context — not specific people or companies.
  const hasPipelinePeople =
    /\bpipeline\b/.test(blob) ||
    /\bhiring manager\b/.test(blob) ||
    /\bco-?founder\b/.test(blob) ||
    /\bpanel\b/.test(blob) ||
    /\bscreen\b/.test(blob) ||
    /\bonsite\b/.test(blob) ||
    /\bfinal round\b/.test(blob);

  const transcriptLike =
    blocks.some((b) => /transcript|recruiter|call notes|debrief/i.test(b.label)) ||
    blob.length > 800;

  return {
    hasRecruiter,
    hasPipelinePeople,
    transcriptLike,
    shouldSuggest: (hasRecruiter || hasPipelinePeople) && transcriptLike,
    blocks,
  };
}

/**
 * Seed stages the job doesn't already have (and the user hasn't dismissed).
 * @returns {Array<{id,title,subtitle,file?,regenTask?,markdown,source:'seed'}>}
 */
export function getSuggestedStages() {
  const job = getActiveJob();
  if (!job) return [];
  const existing = new Set((job.stages || []).map((s) => s.id));
  const dismissed = new Set(getDismissedSuggestions());

  return SEED_STAGES.filter((s) => !existing.has(s.id) && !dismissed.has(s.id)).map((s) => ({
    ...s,
    markdown:
      loadSeedDoc(s.file) ||
      `# ${s.title}\n\nPrep doc will generate from your context when you add this stage.`,
    source: "seed",
  }));
}

/**
 * Personal banner copy when suggestions are available.
 * @param {Array} suggestions
 */
export function buildSuggestionBanner(suggestions) {
  if (!suggestions?.length) return null;
  const signal = detectPipelineContextSignal();
  const first = APP.candidateName?.split(/\s+/)[0] || "there";
  const titles = suggestions.slice(0, 3).map((s) => s.title.replace(/\s*—.*$/, "").trim());
  const more = suggestions.length > 3 ? ` +${suggestions.length - 3} more` : "";

  if (signal.hasRecruiter || signal.hasPipelinePeople) {
    return {
      eyebrow: "New context detected",
      title: `Nice work on the recruiter call, ${first}.`,
      body: `Looks like these are next: ${titles.join(" · ")}${more}. I've prepped draft docs for you to review — click a suggested stage, then Add if it looks right.`,
    };
  }

  return {
    eyebrow: "Suggested stages",
    title: `A few stages are ready to add, ${first}.`,
    body: `I've drafted prep docs for ${titles.join(" · ")}${more}. Review a suggested card, then Add to put it on your pipeline.`,
  };
}

/** True when we should auto-surface the suggestion banner/cards. */
export function shouldShowSuggestions(suggestions) {
  if (!suggestions?.length) return false;
  const signal = detectPipelineContextSignal();
  // Always show if seed stages are missing and there's any pipeline/recruiter signal,
  // OR if the job only has recruiter (or fewer stages than the seed pipeline).
  const job = getActiveJob();
  const stageCount = job?.stages?.length || 0;
  const seedCount = SEED_STAGES.length;
  if (signal.shouldSuggest) return true;
  if (stageCount > 0 && stageCount < seedCount && suggestions.length > 0) return true;
  return false;
}
