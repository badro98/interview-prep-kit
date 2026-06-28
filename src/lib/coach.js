// coach() — the single, pluggable AI entry point for the whole app.
//
// Every live AI feature (prep-doc regenerate now; flashcard coaching, audio scoring,
// take-home brainstorm later) goes through THIS function. Flipping between paste mode
// and API mode is a one-line change here — no feature code changes.
//
//   API MODE (default): routes through the local Express proxy (Gemini out of the box;
//   swap server/gemini.js for Claude, OpenAI, etc.). Requires npm run dev + .env keys.
//
//   PASTE MODE (fallback): assembles the prompt for clipboard copy/paste into an external
//   chat when the proxy is unavailable or you prefer not to use API keys.

import { getContext } from "./context.js";
import { askClaude } from "./claude.js";
import { get, set } from "./store.js";
import { ADVISOR_SYSTEM } from "../features/advisor/systemPrompt.js";
import { getDeck } from "../features/flashcards/deck.js";
import { formatFlashcardsForAdvisor } from "../features/advisor/actions.js";

export const MODE_PASTE = "paste";
export const MODE_API = "api";

const MODE_KEY = "settings:aiMode";

/** Current AI mode. Defaults to API — set up .env and npm run dev. */
export function getMode() {
  return get(MODE_KEY, MODE_API);
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

  // Paste fallback when API / tone scoring unavailable.
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
