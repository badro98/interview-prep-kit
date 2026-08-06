import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/context.js", () => ({
  getActiveContextBlocks: vi.fn(),
}));

import { getActiveContextBlocks } from "../../../lib/context.js";
import { detectPipelineContextSignal } from "../suggestions.js";

function setBlocks(blocks) {
  getActiveContextBlocks.mockReturnValue(blocks);
}

beforeEach(() => {
  getActiveContextBlocks.mockReset();
});

describe("detectPipelineContextSignal", () => {
  it("does not suggest on empty context", () => {
    setBlocks([]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasRecruiter).toBe(false);
    expect(signal.hasPipelinePeople).toBe(false);
    expect(signal.shouldSuggest).toBe(false);
  });

  it("detects recruiter + transcript-like labels", () => {
    setBlocks([
      {
        label: "Recruiter call transcript",
        enabled: true,
        content: "Had a screen with the recruiter about next steps.",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasRecruiter).toBe(true);
    expect(signal.transcriptLike).toBe(true);
    expect(signal.shouldSuggest).toBe(true);
  });

  it("detects generic stage-shape phrases, not people names", () => {
    const longPad = "notes ".repeat(200);
    setBlocks([
      {
        label: "Call notes",
        enabled: true,
        content: `${longPad} Next up is hiring manager, then a panel, then onsite, then final round with the co-founder.`,
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasPipelinePeople).toBe(true);
    expect(signal.transcriptLike).toBe(true);
    expect(signal.shouldSuggest).toBe(true);
  });

  it("ignores disabled blocks", () => {
    setBlocks([
      {
        label: "Recruiter call transcript",
        enabled: false,
        content: "recruiter hiring manager pipeline screen onsite",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.shouldSuggest).toBe(false);
  });

  it("requires transcript-like signal even when pipeline words appear", () => {
    setBlocks([
      {
        label: "Short note",
        enabled: true,
        content: "hiring manager next",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasPipelinePeople).toBe(true);
    expect(signal.transcriptLike).toBe(false);
    expect(signal.shouldSuggest).toBe(false);
  });
});
