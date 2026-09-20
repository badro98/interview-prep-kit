import { describe, expect, it } from "vitest";
import {
  INTENT_CHAT,
  INTENT_PRACTICE,
  classifyVoiceIntent,
  lastAssistantLooksLikePracticePrompt,
} from "../voiceIntent.js";

describe("classifyVoiceIntent", () => {
  it("treats questions as chat, not practice", () => {
    expect(
      classifyVoiceIntent({ transcript: "What should I say about Nuro?" })
    ).toBe(INTENT_CHAT);
    expect(
      classifyVoiceIntent({ transcript: "Can you tighten my STAR for conflict?" })
    ).toBe(INTENT_CHAT);
    expect(
      classifyVoiceIntent({ transcript: "How do I frame the launch?" })
    ).toBe(INTENT_CHAT);
  });

  it("treats interview intel as chat even when long-sounding", () => {
    expect(
      classifyVoiceIntent({
        transcript:
          "Here's what I learned from the screen. The recruiter said they care about execution.",
        durationMs: 400_000,
      })
    ).toBe(INTENT_CHAT);
  });

  it("treats kit asks as chat even after a quiz prompt", () => {
    expect(
      classifyVoiceIntent({
        transcript: "Add this to context please",
        lastAssistantContent: "Try answering that out loud.",
      })
    ).toBe(INTENT_CHAT);
  });

  it("detects practiced answers", () => {
    expect(
      classifyVoiceIntent({
        transcript:
          "The situation was a messy launch. I led the rollback. The result was we recovered in two hours.",
      })
    ).toBe(INTENT_PRACTICE);
    expect(
      classifyVoiceIntent({ transcript: "Let me try. At my last company I owned payments." })
    ).toBe(INTENT_PRACTICE);
  });

  it("uses the last Advisor quiz as practice when the take is ambiguous", () => {
    expect(
      classifyVoiceIntent({
        transcript: "Okay so I was on the platform team and we had an outage.",
        lastAssistantContent: "Try answering that out loud — 60 seconds.",
      })
    ).toBe(INTENT_PRACTICE);
  });

  it("does not treat a normal Advisor question as a practice cue", () => {
    expect(
      lastAssistantLooksLikePracticePrompt(
        "Want me to add flashcards for that round?"
      )
    ).toBe(false);
    expect(
      classifyVoiceIntent({
        transcript: "Yeah that sounds good.",
        lastAssistantContent: "Want me to add flashcards for that round?",
      })
    ).toBe(INTENT_CHAT);
  });

  it("defaults ambiguous speech to chat", () => {
    expect(classifyVoiceIntent({ transcript: "Okay yeah." })).toBe(INTENT_CHAT);
    expect(classifyVoiceIntent({ transcript: "" })).toBe(INTENT_CHAT);
  });

  it("falls back to practice when STT is empty but audio is a real take", () => {
    expect(
      classifyVoiceIntent({
        transcript: "",
        hasAudio: true,
        durationMs: 12_000,
      })
    ).toBe(INTENT_PRACTICE);
  });
});
