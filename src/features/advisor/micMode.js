// Composer mic: Dictate fills the box. Voice records and routes (chat vs practice).
// Paste mode is always dictation — no audio proxy.

export const MIC_DICTATE = "dictate";
export const MIC_VOICE = "voice";

export function usesAudioCapture(micMode, { pasteMode = false } = {}) {
  return micMode === MIC_VOICE && !pasteMode;
}

/** @returns {'keep_in_composer'|'route_voice'} */
export function micStopKind(micMode, { pasteMode = false } = {}) {
  return usesAudioCapture(micMode, { pasteMode }) ? "route_voice" : "keep_in_composer";
}
