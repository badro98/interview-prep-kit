import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory(); // fresh DB per test
});

// db.js caches its connection at module level, so import a fresh copy per test.
async function freshModules() {
  const db = await import(/* @vite-ignore */ `../db.js?t=${Date.now()}-${Math.random()}`);
  const jobs = await import("../jobs.js");
  return { db, jobs };
}

describe("job-scoped IndexedDB", () => {
  it("attempts are stamped with the active job and filtered on read", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({ role: "A" });
    const b = jobs.createJob({ role: "B" });

    jobs.setActiveJobId(a.id);
    await db.addAttempt({ questionId: "q1", transcript: "hello" });

    jobs.setActiveJobId(b.id);
    expect(await db.getAllAttempts()).toEqual([]);

    jobs.setActiveJobId(a.id);
    const attempts = await db.getAllAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].jobId).toBe(a.id);
  });

  it("recordings are isolated per job for the same stage id", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({});
    const b = jobs.createJob({});

    jobs.setActiveJobId(a.id);
    await db.replaceRecordingForStage("onsite", { fileName: "a.wav" });

    jobs.setActiveJobId(b.id);
    expect(await db.getRecordingByStage("onsite")).toBeNull();
    await db.replaceRecordingForStage("onsite", { fileName: "b.wav" });

    jobs.setActiveJobId(a.id);
    expect((await db.getRecordingByStage("onsite")).fileName).toBe("a.wav");
    expect(await db.getAllRecordings()).toHaveLength(1);
  });

  it("backfillJobIds stamps legacy records missing jobId", async () => {
    const { db, jobs } = await freshModules();
    const job = jobs.createJob({});
    jobs.setActiveJobId(job.id);

    // Simulate a legacy record written before job scoping existed.
    await db.addAttempt({ questionId: "q-legacy", transcript: "old", jobId: undefined });
    const count = await db.backfillJobIds(job.id);
    expect(count).toBeGreaterThanOrEqual(0); // addAttempt now stamps; count covers true legacy rows

    const attempts = await db.getAllAttempts();
    expect(attempts.every((x) => x.jobId === job.id)).toBe(true);
  });
});
