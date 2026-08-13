import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/** Convert markdown (seed docs / advisor output) into HTML for the rich editor. */
export function markdownToHtml(markdown) {
  const raw = String(markdown || "").trim();
  if (!raw) return "<p></p>";
  return marked.parse(raw);
}
