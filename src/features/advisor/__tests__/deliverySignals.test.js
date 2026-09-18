import { describe, expect, it } from "vitest";
import {
  deliverySignalsFromTranscript,
  formatDeliverySignals,
} from "../deliverySignals.js";

describe("deliverySignalsFromTranscript", () => {
  it("counts fillers and estimates pace", () => {
    const signals = deliverySignalsFromTranscript({
      transcript: "Um I led the launch and uh the result was we shipped.",
      durationMs: 60_000,
    });
    expect(signals.wordCount).toBeGreaterThan(8);
    expect(signals.fillers).toBeGreaterThanOrEqual(2);
    expect(signals.wpm).toBeGreaterThan(0);
    expect(formatDeliverySignals(signals)).toMatch(/Duration: 60s/);
  });
});
