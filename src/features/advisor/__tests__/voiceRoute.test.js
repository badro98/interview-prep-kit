import { describe, expect, it } from "vitest";
import { INTENT_CHAT, INTENT_PRACTICE } from "../voiceIntent.js";
import {
  ROUTE_CHAT_LONG,
  ROUTE_CHAT_SHORT,
  ROUTE_PRACTICE_LONG,
  ROUTE_PRACTICE_SHORT,
  SHORT_MAX_BYTES,
  SHORT_MAX_MS,
  selectVoiceRoute,
} from "../voiceRoute.js";

describe("selectVoiceRoute", () => {
  it("keeps short questions on the cheap chat path", () => {
    expect(
      selectVoiceRoute({
        intent: INTENT_CHAT,
        durationMs: 25_000,
        byteSize: 80_000,
      })
    ).toBe(ROUTE_CHAT_SHORT);
  });

  it("does not send a 30s question down the practice listen path", () => {
    expect(
      selectVoiceRoute({
        intent: INTENT_CHAT,
        durationMs: 30_000,
        byteSize: 120_000,
      })
    ).not.toBe(ROUTE_PRACTICE_SHORT);
  });

  it("upgrades long intel dumps to chat_long, not practice", () => {
    expect(
      selectVoiceRoute({
        intent: INTENT_CHAT,
        durationMs: SHORT_MAX_MS + 1,
      })
    ).toBe(ROUTE_CHAT_LONG);
  });

  it("splits practice by duration and byte size", () => {
    expect(
      selectVoiceRoute({ intent: INTENT_PRACTICE, durationMs: 45_000 })
    ).toBe(ROUTE_PRACTICE_SHORT);
    expect(
      selectVoiceRoute({ intent: INTENT_PRACTICE, durationMs: SHORT_MAX_MS + 5_000 })
    ).toBe(ROUTE_PRACTICE_LONG);
    expect(
      selectVoiceRoute({
        intent: INTENT_PRACTICE,
        durationMs: 20_000,
        byteSize: SHORT_MAX_BYTES + 1,
      })
    ).toBe(ROUTE_PRACTICE_LONG);
  });
});
