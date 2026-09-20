// Cheap, local intent for Advisor voice turns.
// Chat (questions, intel, kit asks) is the default. Practice is opt-in via
// transcript shape or the last Advisor prompt — never via duration.

export const INTENT_CHAT = "chat";
export const INTENT_PRACTICE = "practice";

const FORCE_CHAT_RE =
  /\b(don'?t coach|not (?:my |an )?answer|just (?:chat|asking)|type this|add this to context)\b/i;

const CHAT_KIT_RE =
  /\b(add to context|make a flashcard|add flashcards?|update the prep doc|update prep doc|spin up|add a stage|add subpage)\b/i;

const CHAT_INTEL_RE =
  /\b(recruiter said|they (?:said|told me|mentioned|asked)|i learned|from the (?:interview|call|screen|on[- ]site)|hiring manager said|what i learned|here'?s what i (?:learned|got)|debrief)\b/i;

const CHAT_QUESTION_RE =
  /[?]\s*$|^(?:can you|could you|would you|should i|how(?:\s+do|\s+should|\s+can|\s+would)?(?:\s+i)?\b|what(?:'s|s)?\s+(?:a |the |should|would|do i|is)|why (?:did|do|is|are)|is there|are there|do you)\b/i;

const PRACTICE_EXPLICIT_RE =
  /\b(let me try|let'?s try|here'?s my answer|here is my answer|i'?ll try answering|coach (?:my )?delivery|score (?:this|my) (?:answer|take)|grade (?:this|me))\b/i;

const PRACTICE_ANSWER_RE =
  /\b(the situation was|situation was|at my last (?:company|role|job)|i (?:led|owned|shipped|drove)|the result was|as a result)\b/i;

const ASSISTANT_PRACTICE_RE =
  /\b(try (?:that |this )?(?:out loud|answering)|say it out loud|your turn|quiz(?: me)?|practice (?:that|this|answering)|answer as if|give me your (?:star|answer))\b/i;

const INTERVIEW_Q_RE =
  /\b(tell me about a time|walk me through a (?:conflict|failure|launch)|how would you (?:handle|approach)|give me an example of)\b/i;

export function lastAssistantLooksLikePracticePrompt(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return ASSISTANT_PRACTICE_RE.test(s) || INTERVIEW_Q_RE.test(s);
}

/**
 * @param {{ transcript?: string, lastAssistantContent?: string, hasAudio?: boolean, durationMs?: number }} opts
 * @returns {'chat'|'practice'}
 */
export function classifyVoiceIntent({
  transcript,
  lastAssistantContent,
  hasAudio = false,
  durationMs = 0,
} = {}) {
  const said = String(transcript || "").trim();

  if (!said) {
    // STT failed but they clearly recorded something — let the model hear it.
    if (hasAudio && durationMs >= 5000) return INTENT_PRACTICE;
    return INTENT_CHAT;
  }

  if (FORCE_CHAT_RE.test(said) || CHAT_KIT_RE.test(said)) return INTENT_CHAT;
  if (CHAT_INTEL_RE.test(said)) return INTENT_CHAT;
  if (CHAT_QUESTION_RE.test(said)) return INTENT_CHAT;

  if (PRACTICE_EXPLICIT_RE.test(said) || PRACTICE_ANSWER_RE.test(said)) {
    return INTENT_PRACTICE;
  }

  if (lastAssistantLooksLikePracticePrompt(lastAssistantContent)) {
    return INTENT_PRACTICE;
  }

  return INTENT_CHAT;
}
