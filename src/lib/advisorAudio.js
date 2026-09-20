// Client wrapper for Advisor voice (long re-STT + practice). Keys stay server-side.

function apiUrl(path) {
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_API_PORT || 3001;
    return `http://localhost:${port}${path}`;
  }
  return path;
}

async function postAdvisorAudio({ blob, type, action, durationMs, system, messages, transcript }) {
  const form = new FormData();
  form.append("file", blob, `take.${type?.includes("wav") ? "wav" : "webm"}`);
  form.append("action", action);
  form.append("durationMs", String(durationMs || 0));
  form.append("mimeType", type || blob.type || "audio/webm");
  form.append("system", system || "");
  form.append("messages", JSON.stringify(messages || []));
  form.append("transcript", transcript || "");

  const res = await fetch(apiUrl("/api/advisor-audio"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Advisor audio proxy error ${res.status}`);
  }
  return res.json();
}

export async function transcribeAdvisorAudio({ blob, type, durationMs }) {
  return postAdvisorAudio({
    blob,
    type,
    action: "transcribe",
    durationMs,
    transcript: "",
    messages: [],
  });
}

export async function practiceAdvisorAudio({
  blob,
  type,
  durationMs,
  action,
  system,
  messages,
  transcript,
}) {
  return postAdvisorAudio({
    blob,
    type,
    action,
    durationMs,
    system,
    messages,
    transcript,
  });
}
