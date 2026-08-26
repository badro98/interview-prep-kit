import { describe, expect, it } from "vitest";
import { CONFIDENCE_MARKER } from "../deck.js";
import {
  buildAudioScoreTask,
  buildScoreTask,
  FILLER_CONFIDENCE_POLICY,
} from "../../audio/scoring.js";

describe("spoken score prompts", () => {
  it("asks for CONFIDENCE: N on audio and transcript scoring", () => {
    const audio = buildAudioScoreTask({ questionText: "Why this role?" });
    const text = buildScoreTask({
      questionText: "Why this role?",
      transcript: "Because I built X.",
    });
    expect(audio).toContain(`${CONFIDENCE_MARKER}: N`);
    expect(text).toContain(`${CONFIDENCE_MARKER}: N`);
    expect(audio).toContain("**Tightened version**");
    expect(text).toContain("**Tightened version**");
    expect(audio).toContain("**Vocal delivery**");
  });

  it("still asks to count fillers in vocal delivery, without letting them set CONFIDENCE", () => {
    const audio = buildAudioScoreTask({ questionText: "Why this role?" });
    const text = buildScoreTask({
      questionText: "Why this role?",
      transcript: "Um, because I built X.",
    });
    expect(audio).toContain("filler words");
    expect(audio).toContain(FILLER_CONFIDENCE_POLICY);
    expect(text).toContain(FILLER_CONFIDENCE_POLICY);
    expect(audio).toMatch(/must not set the CONFIDENCE line/i);
    expect(text).toMatch(/cleanup note, not as the main verdict/i);
  });
});
