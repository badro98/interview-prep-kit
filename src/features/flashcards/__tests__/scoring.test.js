import { describe, expect, it } from "vitest";
import { CONFIDENCE_MARKER } from "../deck.js";
import { buildAudioScoreTask, buildScoreTask } from "../../audio/scoring.js";

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
});
