// Optional OpenAI backends for Advisor voice (STT + short practice listen).
// Used only when OPENAI_API_KEY is set. Gemini remains the default chat model.

export function openaiConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  return key;
}

function extForMime(mimeType) {
  const t = String(mimeType || "");
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  return "webm";
}

export async function transcribeBuffer(buffer, mimeType = "audio/webm") {
  const form = new FormData();
  const filename = `take.${extForMime(mimeType)}`;
  form.append("file", new Blob([buffer], { type: mimeType || "audio/webm" }), filename);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI transcription failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const text = String(data.text || "").trim();
  return { text, words: text.split(/\s+/).filter(Boolean), provider: "openai" };
}

export async function coachWithAudio({ system, messages, audioBase64, mimeType }) {
  const history = (messages || []).slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  const last = (messages || []).at(-1);
  const lastText = last?.content || "";
  const fmt = String(mimeType || "").includes("wav") ? "wav" : "wav";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-audio-preview",
      modalities: ["text"],
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...history,
        {
          role: "user",
          content: [
            { type: "text", text: lastText },
            {
              type: "input_audio",
              input_audio: { data: audioBase64, format: fmt },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI audio coach failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
