// Fetch a public URL via the local proxy (for advisor document/website ingestion).

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractUrls(text) {
  if (!text) return [];
  const matches = String(text).match(URL_RE) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}

/** First URL in the text, else the trimmed input coerced to https://. Null if unusable. */
export function normalizeUrlInput(text) {
  const found = extractUrls(text)[0];
  if (found) return found;
  const trimmed = String(text || "").trim();
  if (!trimmed || /\s/.test(trimmed) || !trimmed.includes(".")) return null;
  const candidate = `https://${trimmed}`;
  try {
    // eslint-disable-next-line no-new
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function fetchUrlContent(url) {
  const res = await fetch("/api/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Could not fetch URL (${res.status})`);
  }

  return res.json();
}
