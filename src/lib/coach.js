// coach() — the single, pluggable AI entry point for the whole app.
//
// Every live AI feature (prep-doc regenerate now; flashcard coaching, audio scoring,
// take-home brainstorm later) goes through THIS function. Flipping between paste mode
// and API mode is a one-line change here — no feature code changes.
//
//   PASTE MODE (default, zero setup): we assemble the full prompt (context + task)
//   and hand it back so the UI can copy it to the clipboard. You paste it into Cursor
//   chat, then paste the reply back into the app. Uses your existing subscription.
//
//   API MODE (optional upgrade): if the local Express proxy is running with a
//   GEMINI_API_KEY in .env, coach() routes through it and returns the model text directly.

import { getContext } from "./context.js";
import { askClaude } from "./claude.js";
import { get, set } from "./store.js";
import { ADVISOR_SYSTEM } from "../features/advisor/systemPrompt.js";
import { getDeck } from "../features/flashcards/deck.js";
import { formatFlashcardsForAdvisor } from "../features/advisor/actions.js";

export const MODE_PASTE = "paste";
export const MODE_API = "api";

const MODE_KEY = "settings:aiMode";

/** Current AI mode. Defaults to paste — no key, no cost, works out of the box. */
export function getMode() {
  return get(MODE_KEY, MODE_PASTE);
}

export function setMode(mode) {
  set(MODE_KEY, mode === MODE_API ? MODE_API : MODE_PASTE);
}

/**
 * Build the clipboard-ready prompt (paste mode). Context block is prepended so the
 * model answers grounded in the real background even in a fresh chat window.
 *
 * @param {object} opts
 * @param {string} opts.task       The instruction / question for this call.
 * @param {boolean} [opts.includeContext=true]
 */
export function buildPrompt({ task, includeContext = true }) {
  const parts = [];
  if (includeContext) {
    parts.push(getContext());
    parts.push("\n----------------------------------------\n");
  }
  parts.push(task.trim());
  return parts.join("\n");
}

/**
 * coach() — request a generation.
 *
 * @param {object} opts
 * @param {string} opts.task                 What you want the model to do.
 * @param {boolean} [opts.includeContext]    Prepend the /context grounding block.
 * @param {string} [opts.system]             System prompt (API mode only).
 *
 * @returns {Promise<{mode: 'paste', prompt: string} | {mode: 'api', text: string}>}
 *   - paste mode: { mode, prompt } — UI copies `prompt`, user pastes reply back.
 *   - api mode:   { mode, text }   — ready to use directly.
 */
export async function coach({ task, includeContext = true, system }) {
  const mode = getMode();

  if (mode === MODE_API) {
    const sys = [system, includeContext ? getContext() : ""]
      .filter(Boolean)
      .join("\n\n");
    const text = await askClaude({
      system: sys,
      messages: [{ role: "user", content: task }],
    });
    return { mode: MODE_API, text };
  }

  // Default: paste mode.
  return { mode: MODE_PASTE, prompt: buildPrompt({ task, includeContext }) };
}

/** Messages for the model (supports modelContent on user turns). */
function advisorMessagesForModel(messages) {
  return (messages || []).map((m) => ({
    role: m.role,
    content: m.modelContent ?? m.content,
  }));
}

function buildAdvisorSystem() {
  const deck = getDeck();
  return [
    ADVISOR_SYSTEM,
    getContext(),
    formatFlashcardsForAdvisor(deck),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * advisorChat() — multi-turn prep advisor conversation.
 *
 * @param {object} opts
 * @param {Array<{role:'user'|'assistant', content:string, modelContent?:string}>} opts.messages
 * @returns {Promise<{mode:'paste', prompt:string}|{mode:'api', text:string}>}
 */
export async function advisorChat({ messages }) {
  const mode = getMode();
  const system = buildAdvisorSystem();
  const modelMessages = advisorMessagesForModel(messages);

  if (mode === MODE_API) {
    const text = await askClaude({ system, messages: modelMessages });
    return { mode: MODE_API, text };
  }

  const transcript = modelMessages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
  const prompt = [
    system,
    "\n----------------------------------------\n",
    "CONVERSATION SO FAR:\n",
    transcript,
    "\n\nRespond as the Assistant to the latest User message. Continue the conversation naturally.",
  ].join("\n");

  return { mode: MODE_PASTE, prompt };
}
