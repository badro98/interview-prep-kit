import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { setCardProgress, getProgressMap } from "../../../lib/store.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";
import { _resetDbConnection, getAttemptsForQuestion } from "../../../lib/db.js";
import {
  createBlankAttempt,
  loadCardAttempts,
  patchAttempt,
} from "../attempts.js";

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  _resetDbConnection();
});

const card = {
  id: "b01",
  question: "Tell me about a time you led a team.",
  category: "behavioral",
  referenceAnswer: "At Acme I led…",
  keyPoints: ["metric", "team"],
};

describe("flashcard attempts", () => {
  it("migrates legacy progress into attempt #1 and projects the active take", async () => {
    const job = createJob({});
    setActiveJobId(job.id);
    setCardProgress("b01", {
      myAnswer: "I led a squad of 6.",
      aiCoaching: "**What's strong** — ownership.",
      confidence: 3,
    });

    const loaded = await loadCardAttempts(card);
    expect(loaded.attempts).toHaveLength(1);
    expect(loaded.attempts[0].transcript).toBe("I led a squad of 6.");
    expect(loaded.attempts[0].score).toContain("ownership");
    expect(loaded.attempts[0].confidence).toBe(3);
    expect(loaded.activeId).toBe(loaded.attempts[0].id);

    const progress = getProgressMap()["b01"];
    expect(progress.activeAttemptId).toBe(loaded.activeId);
    expect(progress.myAnswer).toBe("I led a squad of 6.");
    expect(progress.confidence).toBe(3);
  });

  it("does not migrate twice once attempts exist", async () => {
    const job = createJob({});
    setActiveJobId(job.id);
    setCardProgress("b01", { myAnswer: "first", confidence: 2 });

    await loadCardAttempts(card);
    setCardProgress("b01", { myAnswer: "should not become attempt 2" });
    const loaded = await loadCardAttempts(card);
    expect(loaded.attempts).toHaveLength(1);
    expect(await getAttemptsForQuestion("b01")).toHaveLength(1);
  });

  it("new blank attempts are independent and patchAttempt updates only the active projection", async () => {
    const job = createJob({});
    setActiveJobId(job.id);

    const a1 = await createBlankAttempt(card);
    await patchAttempt(card.id, a1.id, {
      transcript: "take one",
      score: "analysis one",
      confidence: 2,
    });
    const a2 = await createBlankAttempt(card);
    await patchAttempt(card.id, a2.id, {
      transcript: "take two",
      score: "analysis two",
      confidence: 5,
    });

    const loaded = await loadCardAttempts(card);
    expect(loaded.attempts).toHaveLength(2);
    expect(loaded.attempts[0].transcript).toBe("take one");
    expect(loaded.attempts[0].confidence).toBe(2);
    expect(loaded.attempts[1].transcript).toBe("take two");
    expect(loaded.attempts[1].confidence).toBe(5);
    expect(getProgressMap()["b01"].confidence).toBe(5);
    expect(getProgressMap()["b01"].myAnswer).toBe("take two");
  });

  it("does not create a blank row just by browsing an unanswered card", async () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const loaded = await loadCardAttempts(card);
    expect(loaded.attempts).toEqual([]);
    expect(await getAttemptsForQuestion("b01")).toEqual([]);
  });
});
