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
    await db.backfillJobIds(job.id);

    const attempts = await db.getAllAttempts();
    expect(attempts.every((x) => x.jobId === job.id)).toBe(true);
  });

  it("deleteJobRecords removes only the target job's rows in both stores", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({});
    const b = jobs.createJob({});

    jobs.setActiveJobId(a.id);
    await db.addAttempt({ questionId: "q1", transcript: "a1" });
    await db.addAttempt({ questionId: "q2", transcript: "a2" });
    await db.replaceRecordingForStage("onsite", { fileName: "a.wav" });

    jobs.setActiveJobId(b.id);
    await db.addAttempt({ questionId: "q1", transcript: "b1" });
    await db.replaceRecordingForStage("onsite", { fileName: "b.wav" });

    const result = await db.deleteJobRecords(a.id);
    expect(result).toEqual({ attempts: 2, recordings: 1 });

    jobs.setActiveJobId(a.id);
    expect(await db.getAllAttempts()).toEqual([]);
    expect(await db.getAllRecordings()).toEqual([]);

    jobs.setActiveJobId(b.id);
    const bAttempts = await db.getAllAttempts();
    expect(bAttempts).toHaveLength(1);
    expect(bAttempts[0].transcript).toBe("b1");
    const bRecordings = await db.getAllRecordings();
    expect(bRecordings).toHaveLength(1);
    expect(bRecordings[0].fileName).toBe("b.wav");
  });
});
