// Fetch public URLs for advisor context (server-side only).

const MAX_BYTES = 500_000;
const MAX_TEXT = 40_000;

function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : "";
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const text = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/ +/g, " ").trim();
  return { title, text: text.slice(0, MAX_TEXT) };
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (h === "::1") return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export async function fetchPublicUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are supported.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("Private/local URLs are not allowed.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "InterviewPrepBot/1.0 (+local dev)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url.hostname}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error("Page too large to ingest (max ~500KB). Paste the text manually.");
  }

  const body = buf.toString("utf-8");

  if (contentType.includes("text/plain")) {
    return {
      url: url.toString(),
      title: url.pathname.split("/").pop() || url.hostname,
      text: body.slice(0, MAX_TEXT),
    };
  }

  const { title, text } = htmlToText(body);
  if (!text) {
    throw new Error("Could not extract readable text from that page.");
  }

  return {
    url: url.toString(),
    title: title || url.hostname,
    text,
  };
}
