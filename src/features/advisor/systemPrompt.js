// System prompt for the prep advisor chat agent — built from interview.config.js.

import { buildAdvisorSystem } from "../../../interview.config.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getProfileName } from "../../lib/profile.js";
import { getCurrentStageId, getStageProgressMap } from "../../lib/store.js";

const RESPONSE_STYLE = `
RESPONSE_STYLE:
- Default to concise answers: lead with the direct answer, then at most 4–8 tight bullets or ~150 words.
- One story/metric per point — not exhaustive lists. No restating the question or long preambles.
- Expand into full detail only when the user asks (e.g. "detailed", "in depth", "full prep doc", "walk me through") or when drafting add_stage prep-doc content.
- Never abbreviate the advisor-actions JSON block — proposal content stays complete.
- When web search is available, use it for time-sensitive or company questions and cite sources. Otherwise say when knowledge may be stale.
`.trim();

/** Built fresh per call from the active job — never cache at module load. */
export function getAdvisorSystem() {
  const job = getActiveJob();
  const stageIds = (job?.stages || []).map((s) => s.id);
  const base = buildAdvisorSystem({
    ...job,
    candidateName: getProfileName(),
    stageProgress: getStageProgressMap(stageIds),
    currentStageId: getCurrentStageId(stageIds),
  });
  return `${base}\n\n${RESPONSE_STYLE}`;
}
