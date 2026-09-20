const FILLER_RE = /\b(um+|uh+|er+|ah+|like|you know|sort of|kind of)\b/gi;

/**
 * @param {{ transcript?: string, durationMs?: number, words?: string[] }} opts
 */
export function deliverySignalsFromTranscript({
  transcript = "",
  durationMs = 0,
  words,
} = {}) {
  const text = String(transcript || "");
  const wordList = Array.isArray(words)
    ? words.map((w) => String(w || "").trim()).filter(Boolean)
    : text.split(/\s+/).filter(Boolean);
  const minutes = Math.max(Number(durationMs) / 60000, 1 / 60);
  const fillers = text.match(FILLER_RE) || [];
  return {
    durationMs: Number(durationMs) || 0,
    wordCount: wordList.length,
    wpm: Math.round(wordList.length / minutes),
    fillers: fillers.length,
  };
}

export function formatDeliverySignals(signals) {
  const s = signals || {};
  const secs = Math.round((s.durationMs || 0) / 1000);
  return `Duration: ${secs}s. ~${s.wpm || 0} words/min. Filler-ish words: ${s.fillers || 0}.`;
}
