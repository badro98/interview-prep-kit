// System prompt for the prep advisor chat agent — built from interview.config.js.

import { buildAdvisorSystem } from "../../../interview.config.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getProfileName } from "../../lib/profile.js";
import { getCurrentStageId, getStageProgressMap } from "../../lib/store.js";

const RESPONSE_STYLE = `
RESPONSE_STYLE:
- Default to concise answers: lead with the direct answer, then at most 4–8 tight bullets or ~150 words.
- One story/metric per point — not exhaustive lists. No restating the question or long preambles.
- Never paste a full prep doc (or a near-full rewrite) into chat. If they ask to regenerate, rewrite, update, refresh, or replace a stage prep doc, emit update_prep_doc in the SAME reply (tiny JSON + a prep-doc fence) and keep chat to a short summary plus the Confirm card.
- Expand into full detail in chat only when they want to talk it through without changing the kit (e.g. "walk me through", "quiz me", "detailed").
- Never abbreviate proposal fences — metadata JSON and prep-doc markdown must be complete.
- When web search is available, use it for time-sensitive or company questions and cite sources. Otherwise say when knowledge may be stale.
`.trim();

const KIT_ACTIONS = `
KIT ACTIONS (propose only — never claim you already changed the kit):
You may include these proposal types in the advisor-actions JSON block, mixed with add_flashcards / add_context / add_stage.

update_prep_doc — write a stage's prep doc into Prep Docs after the user confirms. Use a stage id from the interview stages list (title match is ok, e.g. "Recruiter Screen" → recruiter).
- mode "replace" (default) when they ask to regenerate, rewrite, replace, or "update the prep doc based on" new context.
- mode "append" only when they ask to add a section or notes without replacing the rest.
- Do not dump the document in chat prose. Always emit BOTH fences in this same reply:

\`\`\`advisor-actions
{"proposals":[{"type":"update_prep_doc","stageId":"recruiter","mode":"replace"}]}
\`\`\`

\`\`\`prep-doc
# Recruiter Screen

...complete markdown for the stage...
\`\`\`

When they ask to regenerate/update a prep doc: you MUST emit update_prep_doc in this reply. Put metadata only in the advisor-actions JSON (no markdown inside JSON — quotes/newlines break parsing). Put the complete markdown in a following prep-doc fence. Do not recap the doc in chat, do not ask "should I propose this?", and do not use add_stage for an existing stage.
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
  return `${base}\n\n${RESPONSE_STYLE}\n\n${KIT_ACTIONS}`;
}
