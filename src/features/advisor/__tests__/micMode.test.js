import { describe, expect, it } from "vitest";
import {
  MIC_DICTATE,
  MIC_VOICE,
  micStopKind,
  usesAudioCapture,
} from "../micMode.js";

describe("micMode", () => {
  it("keeps Dictate (and paste) as composer text — no audio upload", () => {
    expect(micStopKind(MIC_DICTATE)).toBe("keep_in_composer");
    expect(usesAudioCapture(MIC_DICTATE)).toBe(false);
    expect(micStopKind(MIC_VOICE, { pasteMode: true })).toBe("keep_in_composer");
    expect(usesAudioCapture(MIC_VOICE, { pasteMode: true })).toBe(false);
  });

  it("only Voice mode captures audio for the practice/re-STT proxy", () => {
    expect(micStopKind(MIC_VOICE)).toBe("route_voice");
    expect(usesAudioCapture(MIC_VOICE)).toBe(true);
  });
});
