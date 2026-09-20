// Duration / size router — only after intent is known.
// Short chat must stay a cheap text turn (no upload, no listen).

import { INTENT_PRACTICE } from "./voiceIntent.js";

export const SHORT_MAX_MS = 120_000;
export const SHORT_MAX_BYTES = 20 * 1024 * 1024;

export const ROUTE_CHAT_SHORT = "chat_short";
export const ROUTE_CHAT_LONG = "chat_long";
export const ROUTE_PRACTICE_SHORT = "practice_short";
export const ROUTE_PRACTICE_LONG = "practice_long";

export function isLongTake({ durationMs = 0, byteSize = 0 } = {}) {
  return Number(durationMs) > SHORT_MAX_MS || Number(byteSize) > SHORT_MAX_BYTES;
}

/**
 * @param {{ intent: string, durationMs?: number, byteSize?: number }} opts
 * @returns {'chat_short'|'chat_long'|'practice_short'|'practice_long'}
 */
export function selectVoiceRoute({ intent, durationMs = 0, byteSize = 0 } = {}) {
  const long = isLongTake({ durationMs, byteSize });
  if (intent === INTENT_PRACTICE) {
    return long ? ROUTE_PRACTICE_LONG : ROUTE_PRACTICE_SHORT;
  }
  return long ? ROUTE_CHAT_LONG : ROUTE_CHAT_SHORT;
}
