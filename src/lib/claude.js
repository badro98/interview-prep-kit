// Frontend fetch wrapper to the Express proxy (API mode only).
//
// In paste mode this file is never called. In API mode, coach() routes here, which
// POSTs to /api/chat (proxied to the local Gemini server, which holds the key server-side).

export async function askClaude({ system, messages }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(`Proxy error ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = await res.json();
  return data.text;
}

/** Cheap probe so coach() can fall back to paste mode if the proxy isn't running. */
export async function isProxyReachable() {
  try {
    const res = await fetch("/api/health", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
