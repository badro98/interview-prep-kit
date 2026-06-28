// Client side of audio scoring: convert the recording to WAV, send it + the prompt
// to the local proxy, which calls Gemini (key stays server-side).

import { getContext } from "../../lib/context.js";
import { blobToWavBase64 } from "./audioToWav.js";
import { buildAudioScoreTask } from "./scoring.js";

/** Is the proxy up AND configured with a Gemini key? */
export async function getProxyStatus() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return { reachable: false, configured: false };
    const data = await res.json();
    return { reachable: true, configured: !!data.configured, model: data.model };
  } catch {
    return { reachable: false, configured: false };
  }
}

/**
 * Score an attempt's audio for tone + content via Gemini.
 * @returns {Promise<string>} the Markdown score
 */
export async function scoreAttemptAudio(attempt) {
  if (!attempt?.audioBlob) throw new Error("This attempt has no audio to score.");

  const audioBase64 = await blobToWavBase64(attempt.audioBlob);

  const prompt = [
    getContext(),
    "\n----------------------------------------\n",
    buildAudioScoreTask({
      questionText: attempt.questionText,
      referenceAnswer: attempt.referenceAnswer,
      keyPoints: attempt.keyPoints,
    }),
  ].join("\n");

  const res = await fetch("/api/score-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, audioBase64, mimeType: "audio/wav" }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Scoring proxy error ${res.status}`);
  }
  const data = await res.json();
  return data.text;
}
