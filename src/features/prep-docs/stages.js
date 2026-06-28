// Stage definitions — loads build-time generated markdown from /generated.
// Stage metadata lives in interview.config.js at the project root.

import { STAGES } from "../../../interview.config.js";

const DOCS = import.meta.glob("../../../generated/prep-*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function loadDoc(fileName) {
  const match = Object.entries(DOCS).find(([path]) => path.endsWith(fileName));
  return match ? String(match[1]) : `# Missing\n\nCould not find /generated/${fileName}.`;
}

export { STAGES };

/** Returns the stage object plus its build-time markdown. */
export function getStageDoc(stageId) {
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) return null;
  return { ...stage, markdown: loadDoc(stage.file) };
}
