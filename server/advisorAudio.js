// Advisor voice adapter: pick STT / listen backends from env.
// Short chat never hits this module.

import {
  generateChat,
  generateChatWithAudio,
  isConfigured as geminiConfigured,
} from "./gemini.js";
import { transcribeSolo, isConfigured as assemblyConfigured } from "./assemblyai.js";
import {
  transcribeBuffer as openaiTranscribe,
  coachWithAudio as openaiCoachWithAudio,
  openaiConfigured,
} from "./openaiAudio.js";
import {
  deliverySignalsFromTranscript,
  formatDeliverySignals,
} from "../src/features/advisor/deliverySignals.js";

function practiceShortPrompt(transcript) {
  return [
    "VOICE PRACTICE — you can HEAR the attached audio.",
    "The user practiced an interview answer out loud. Coach BOTH framing/content AND vocal delivery (pace, fillers, confidence, energy) from how they sound.",
    "Keep it tight: 2–4 coaching notes, then one concrete retry cue.",
    "Do not use a flashcard score template. Do not claim you changed the kit.",
    transcript
      ? `\nLive transcript (may be imperfect):\n${transcript}`
      : "\n(No live transcript — rely on the audio.)",
  ].join("\n");
}

function practiceLongPrompt(transcript, signals) {
  return [
    "VOICE PRACTICE — transcript + delivery signals only (you do not have the audio).",
    "Coach framing from the transcript and delivery from the signals.",
    "Keep it tight: a short structure recap, then 2–4 notes, then one retry cue.",
    "Do not claim you changed the kit.",
    `\n${formatDeliverySignals(signals)}`,
    `\nTranscript:\n${transcript || "(empty)"}`,
  ].join("\n");
}

async function transcribeLong({ buffer, mimeType }) {
  if (assemblyConfigured()) {
    const result = await transcribeSolo(buffer);
    return {
      text: result.text,
      words: result.words,
      durationMs: result.durationMs,
      provider: result.provider,
    };
  }
  if (openaiConfigured()) {
    const result = await openaiTranscribe(buffer, mimeType);
    return {
      text: result.text,
      words: result.words,
      durationMs: 0,
      provider: result.provider,
    };
  }
  return null;
}

function withLastUserText(messages, text) {
  const list = Array.isArray(messages) ? [...messages] : [];
  if (list.length === 0) return [{ role: "user", content: text }];
  const last = list[list.length - 1];
  list[list.length - 1] = { ...last, role: "user", content: text };
  return list;
}

/**
 * @param {{
 *   action: 'transcribe'|'practice_short'|'practice_long',
 *   buffer: Buffer,
 *   mimeType: string,
 *   durationMs: number,
 *   system: string,
 *   messages: Array<{role:string, content:string}>,
 *   transcript: string,
 * }} opts
 */
export async function handleAdvisorAudio({
  action,
  buffer,
  mimeType,
  durationMs,
  system,
  messages,
  transcript,
}) {
  if (action === "transcribe") {
    const result = await transcribeLong({ buffer, mimeType });
    if (!result?.text) {
      throw new Error(
        "Long dictation re-transcript needs ASSEMBLYAI_API_KEY or OPENAI_API_KEY. Using the live transcript instead."
      );
    }
    return { transcript: result.text, provider: result.provider };
  }

  if (action === "practice_short") {
    const userText = practiceShortPrompt(transcript);
    const nextMessages = withLastUserText(messages, userText);
    if (geminiConfigured()) {
      const text = await generateChatWithAudio({
        system,
        messages: nextMessages,
        audioBuffer: buffer,
        mimeType: mimeType || "audio/wav",
      });
      return { text, provider: "gemini" };
    }
    if (openaiConfigured()) {
      const text = await openaiCoachWithAudio({
        system,
        messages: nextMessages,
        audioBase64: buffer.toString("base64"),
        mimeType: mimeType || "audio/wav",
      });
      return { text, provider: "openai" };
    }
    throw new Error("Practice listen needs GEMINI_API_KEY or OPENAI_API_KEY.");
  }

  if (action === "practice_long") {
    const stt = await transcribeLong({ buffer, mimeType });
    if (!stt?.text && geminiConfigured()) {
      const userText = practiceShortPrompt(transcript);
      const nextMessages = withLastUserText(messages, userText);
      const text = await generateChatWithAudio({
        system,
        messages: nextMessages,
        audioBuffer: buffer,
        mimeType: mimeType || "audio/webm",
      });
      return { text, transcript, provider: "gemini" };
    }
    const finalTranscript = stt?.text || transcript || "";
    const signals = deliverySignalsFromTranscript({
      transcript: finalTranscript,
      durationMs: stt?.durationMs || durationMs,
      words: stt?.words,
    });
    const userText = practiceLongPrompt(finalTranscript, signals);
    const nextMessages = withLastUserText(messages, userText);
    const text = await generateChat({
      system,
      messages: nextMessages,
      webSearch: false,
    });
    return {
      text,
      transcript: finalTranscript,
      provider: stt?.provider || "gemini",
    };
  }

  throw new Error(`Unknown advisor audio action: ${action}`);
}
