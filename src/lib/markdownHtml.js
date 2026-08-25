import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

const WRAP_LANG = /^(markdown|md|text)$/i;

/** Strip a wrapping ```markdown fence and shared leading indent so the body parses as prose. */
export function normalizePrepMarkdown(text) {
  let s = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  s = dedentSharedIndent(s);
  s = unwrapOuterMarkdownFence(s);
  s = dedentSharedIndent(s);
  return s.trim();
}

function unwrapOuterMarkdownFence(text) {
  const s = String(text || "").trim();
  const open = s.match(/^([`~]{3,})([^\n]*)\n/);
  if (!open) return s;
  const marker = open[1];
  const lang = String(open[2] || "").trim().split(/\s+/)[0] || "";
  if (lang && !WRAP_LANG.test(lang)) return s;
  const rest = s.slice(open[0].length);
  const closeRe = new RegExp(`(?:^|\\n)${escapeRegExp(marker)}[ \\t]*$`);
  const close = rest.match(closeRe);
  if (close) return rest.slice(0, rest.length - close[0].length).replace(/^\n/, "");
  if (!rest.includes(`\n${marker}`) && (/^#{1,6}\s/m.test(rest) || /^\|/m.test(rest))) {
    return rest;
  }
  return s;
}

function dedentSharedIndent(text) {
  const s = String(text || "").replace(/\t/g, "    ");
  const lines = s.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  if (!indents.length) return s;
  const n = Math.min(...indents);
  if (n === 0) return s;
  return lines.map((line) => (line.length >= n ? line.slice(n) : line)).join("\n");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert markdown (seed docs / advisor output) into HTML for the rich editor. */
export function markdownToHtml(markdown) {
  const raw = normalizePrepMarkdown(markdown);
  if (!raw) return "<p></p>";
  return marked.parse(raw);
}
