import { describe, expect, it } from "vitest";
import {
  LONG_ANSWER_CHARS,
  PLAYFUL_LINES,
  STAGES,
  TEXT_DELAY_MS,
  THINKING_BUCKETS,
  advanceThinking,
  linesForStage,
  resolveThinkingStage,
  shuffleLines,
  stageFromUserText,
} from "../thinkingStatus.js";

describe("TEXT_DELAY_MS", () => {
  it("holds copy until the call has been busy 800ms", () => {
    expect(TEXT_DELAY_MS).toBe(800);
  });
});

describe("stageFromUserText", () => {
  it("defaults to neutral for short unrelated asks", () => {
    expect(stageFromUserText("What's my readiness?")).toBe(STAGES.NEUTRAL);
    expect(stageFromUserText("")).toBe(STAGES.NEUTRAL);
  });

  it("maps generating-question asks", () => {
    expect(stageFromUserText("generate questions from this role")).toBe(STAGES.GENERATING);
    expect(stageFromUserText("Quiz me on system design")).toBe(STAGES.GENERATING);
    expect(stageFromUserText("flashcards from this posting")).toBe(STAGES.GENERATING);
  });

  it("maps scoring / feedback asks", () => {
    expect(stageFromUserText("Give me feedback on that")).toBe(STAGES.SCORING);
    expect(stageFromUserText("Please grade this")).toBe(STAGES.SCORING);
    expect(stageFromUserText("score my answer")).toBe(STAGES.SCORING);
  });

  it("maps resume / JD / URL parsing", () => {
    expect(stageFromUserText("scan my resume")).toBe(STAGES.PARSING);
    expect(stageFromUserText("Here's the job description for Nuro")).toBe(STAGES.PARSING);
    expect(stageFromUserText("ingest this JD")).toBe(STAGES.PARSING);
    expect(stageFromUserText("https://jobs.example.com/pm")).toBe(STAGES.PARSING);
  });

  it("maps analyzing an answer the user gave", () => {
    expect(stageFromUserText("coach this")).toBe(STAGES.ANALYZING);
    expect(stageFromUserText("How did I do?")).toBe(STAGES.ANALYZING);
    expect(stageFromUserText("score this")).toBe(STAGES.ANALYZING);
    expect(stageFromUserText("x".repeat(LONG_ANSWER_CHARS))).toBe(STAGES.ANALYZING);
  });

  it("prefers generate / score-my over a JD or resume mention", () => {
    expect(stageFromUserText("flashcards from this job description")).toBe(
      STAGES.GENERATING
    );
    expect(stageFromUserText("score my resume")).toBe(STAGES.SCORING);
  });
});

describe("resolveThinkingStage", () => {
  it("uses parsing while URLs are actually being fetched", () => {
    expect(
      resolveThinkingStage({
        userText: "quiz me using https://jobs.example.com/pm",
        phase: "fetching",
      })
    ).toBe(STAGES.PARSING);
  });

  it("infers from the user message during the model call", () => {
    expect(
      resolveThinkingStage({
        userText: "quiz me using https://jobs.example.com/pm",
        phase: "thinking",
      })
    ).toBe(STAGES.GENERATING);
  });

  it("honors an explicit stage prop", () => {
    expect(
      resolveThinkingStage({
        userText: "quiz me",
        stage: STAGES.SCORING,
      })
    ).toBe(STAGES.SCORING);
  });
});

describe("linesForStage", () => {
  it("stays inside the active bucket", () => {
    const lines = linesForStage(STAGES.PARSING, () => 0);
    expect(lines).toEqual(THINKING_BUCKETS[STAGES.PARSING]);
    expect(lines.some((line) => PLAYFUL_LINES.includes(line))).toBe(false);
  });

  it("adds at most one playful line for analyzing and generating", () => {
    const analyzing = linesForStage(STAGES.ANALYZING, () => 0);
    const generating = linesForStage(STAGES.GENERATING, () => 0);
    const playfulIn = (list) => list.filter((line) => PLAYFUL_LINES.includes(line));

    expect(playfulIn(analyzing)).toHaveLength(1);
    expect(playfulIn(generating)).toHaveLength(1);
    expect(analyzing).toEqual([...THINKING_BUCKETS[STAGES.ANALYZING], PLAYFUL_LINES[0]]);
    expect(THINKING_BUCKETS[STAGES.NEUTRAL]).not.toEqual(
      expect.arrayContaining(PLAYFUL_LINES)
    );
  });

  it("never uses verdict-y or riff-on-the-user copy", () => {
    const banned =
      /hmm|interesting choice|oh boy|\.\.\.|rambles|swagger|bomb|calibrat/i;
    const all = [
      ...Object.values(THINKING_BUCKETS).flat(),
      ...PLAYFUL_LINES,
    ];
    for (const line of all) {
      expect(line).not.toMatch(banned);
    }
  });
});

describe("shuffleLines", () => {
  it("returns every line once", () => {
    const source = THINKING_BUCKETS[STAGES.NEUTRAL];
    const shuffled = shuffleLines(source, null, () => 0.3);
    expect(shuffled).toHaveLength(source.length);
    expect(new Set(shuffled)).toEqual(new Set(source));
  });

  it("does not start on the previous last line", () => {
    const source = THINKING_BUCKETS[STAGES.NEUTRAL];
    const last = source[0];
    const shuffled = shuffleLines(source, last, () => 0);
    expect(shuffled[0]).not.toBe(last);
    expect(shuffled).toContain(last);
  });
});

describe("advanceThinking", () => {
  it("walks one stage list then reshuffles without repeating the last line", () => {
    const order = ["a", "b", "c"];
    expect(advanceThinking(order, 0)).toEqual({ order, index: 1, line: "b" });
    expect(advanceThinking(order, 1)).toEqual({ order, index: 2, line: "c" });
    const wrapped = advanceThinking(order, order.length - 1, () => 0);
    expect(wrapped.index).toBe(0);
    expect(wrapped.line).not.toBe("c");
    expect(new Set(wrapped.order)).toEqual(new Set(order));
  });
});
