// Stage definitions — loads build-time generated markdown from /generated.
// Stage metadata lives per-job (job.stages), seeded from interview.config.js
// at job creation.

import { getActiveJob } from "../../lib/jobs.js";

const DOCS = import.meta.glob("../../../generated/prep-*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const NO_DOC_PLACEHOLDER =
  "# No prep doc yet\n\nAsk Advisor to draft this stage from your context.";

function loadDoc(fileName) {
  const match = Object.entries(DOCS).find(([path]) => path.endsWith(fileName));
  return match ? String(match[1]) : `# Missing\n\nCould not find /generated/${fileName}.`;
}

/** Returns the active job's stage list (empty if no active job). */
export function getStages() {
  return getActiveJob()?.stages || [];
}

/** Returns the stage object plus its markdown (bundled doc if seed-backed, placeholder otherwise). */
export function getStageDoc(stageId) {
  const stage = getStages().find((s) => s.id === stageId);
  if (!stage) return null;
  return { ...stage, markdown: stage.file ? loadDoc(stage.file) : NO_DOC_PLACEHOLDER };
}
