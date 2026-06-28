// Server-side context loader — reads /context/*.md from disk for summary grounding.
// Client may also send an assembled context block (includes local overrides).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONTEXT_LABELS, CONTEXT_ORDER } from "../interview.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = path.join(__dirname, "..", "context");

/** Built-in context from /context/*.md (server-side fallback). */
export function getServerContext() {
  if (!fs.existsSync(CONTEXT_DIR)) {
    return "(No /context directory found on server.)";
  }

  const files = fs
    .readdirSync(CONTEXT_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => {
      const ia = CONTEXT_ORDER.indexOf(a);
      const ib = CONTEXT_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

  const blocks = files.map((name) => {
    const content = fs.readFileSync(path.join(CONTEXT_DIR, name), "utf8").trim();
    const label = CONTEXT_LABELS[name] || name;
    return `===== ${label} (${name}) =====\n\n${content}`;
  });

  if (!blocks.length) {
    return "(No context files found.)";
  }

  return [
    "The following is the candidate's full background. Treat it as ground truth.",
    "Use the candidate's REAL stories, metrics, and details — never invent generic examples.",
    "",
    blocks.join("\n\n\n"),
  ].join("\n");
}
