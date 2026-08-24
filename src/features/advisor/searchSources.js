/** Pull Gemini grounding **Sources:** lists out of advisor chat markdown. */

export function splitSearchSources(content) {
  const text = String(content || "");
  const match = text.match(/\n\n\*\*Sources:\*\*\n((?:[-*] .+\n?)*)\s*$/);
  if (!match) return { body: text, sources: [] };

  const sources = [];
  const seen = new Set();
  for (const line of match[1].split("\n")) {
    const m = line.match(/^[-*] \[([^\]]+)\]\(([^)]+)\)\s*$/);
    if (!m) continue;
    const url = m[2].trim();
    const parsed = parseSource(url, m[1].trim());
    if (!parsed || seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    sources.push(parsed);
  }

  return { body: text.slice(0, match.index).trimEnd(), sources };
}

export function uniqueSourceHosts(sources) {
  const seen = new Set();
  const unique = [];
  for (const s of sources || []) {
    if (!s?.host || seen.has(s.host)) continue;
    seen.add(s.host);
    unique.push(s);
  }
  return unique;
}

function parseSource(url, title) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (!host) return null;
    return { title: title || host, url, host };
  } catch {
    return null;
  }
}
