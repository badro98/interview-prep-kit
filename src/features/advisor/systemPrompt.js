// System prompt for the prep advisor chat agent — built from interview.config.js.

import { buildAdvisorSystem } from "../../../interview.config.js";
import { getActiveJob } from "../../lib/jobs.js";
import { getProfileName } from "../../lib/profile.js";
import { getCurrentStageId, getStageProgressMap } from "../../lib/store.js";

const RESPONSE_STYLE = `
RESPONSE_STYLE:
- Default to concise answers: lead with the direct answer, then at most 4–8 tight bullets or ~150 words.
- One story/metric per point — not exhaustive lists. No restating the question or long preambles.
- Never paste a full prep doc (or a near-full rewrite) into chat. If they ask to spin up, regenerate, rewrite, or replace prep docs, emit kit proposals in the SAME reply (tiny JSON + <prep-doc> tags) and keep chat to a short summary plus the Confirm card.
- Expand into full detail in chat only when they want to talk it through without changing the kit (e.g. "walk me through", "quiz me", "detailed").
- Never abbreviate proposal blocks — metadata JSON and each <prep-doc> body must be complete.
- When web search is available, use it for time-sensitive or company questions and cite sources. Otherwise say when knowledge may be stale.
`.trim();

const KIT_ACTIONS = `
KIT ACTIONS (propose only — never claim you already changed the kit):
You may include these proposal types in the advisor-actions JSON block, mixed with add_flashcards / add_context.

add_stage — NEW interview round + prep doc (e.g. they just learned there will be a coding round or system design). Use a new id (slug of the title).
update_prep_doc — rewrite or append a prep doc for an EXISTING stage id from the interview stages list (title match is ok).
- mode "replace" (default) for regenerate/rewrite/"based on new context".
- mode "append" only to add a section without replacing the rest.

Never put markdown inside JSON (quotes/newlines/code fences break parsing). After a tiny JSON block, emit each document as an XML tag — code samples inside are fine:

\`\`\`advisor-actions
{"proposals":[{"type":"add_stage","id":"coding","title":"Practical coding","subtitle":"Virtual"}]}
\`\`\`

<prep-doc stageId="coding" title="Practical coding">
# Practical coding

...complete markdown, including \`\`\` code fences if needed...
</prep-doc>

For multiple new rounds, one JSON array with one proposal per stage, then one <prep-doc stageId="..."> per stage.

When they ask to spin up / regenerate / update prep docs: emit the proposals in THIS reply. Keep chat to a short summary (do not recap the docs). Do not ask "should I propose this?". Do not use update_prep_doc for a stage that is not on the interview stages list — use add_stage instead.
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
