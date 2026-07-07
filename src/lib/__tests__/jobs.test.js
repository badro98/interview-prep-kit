import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  getActiveJobId,
  setActiveJobId,
  getActiveJob,
  ensureDefaultJob,
  isSeedBacked,
  deleteJobWithData,
  exportJob,
  importJob,
} from "../jobs.js";
import { get as storageGet, set as storageSet } from "../storage.js";
import {
  APP,
  STAGES,
  STAGE_PRESETS,
  buildAdvisorSystem,
} from "../../../interview.config.js";

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory(); // fresh DB per test
});

// jobs.js statically imports db.js, which caches its connection at module
// scope. Cache-busting both with the same query param binds the fresh
// jobs.js to the fresh db.js so IDB state is isolated per test.
async function freshModules() {
  const t = `${Date.now()}-${Math.random()}`;
  const db = await import(/* @vite-ignore */ `../db.js?t=${t}`);
  const jobs = await import(/* @vite-ignore */ `../jobs.js?t=${t}`);
  return { db, jobs };
}

describe("jobs collection", () => {
  it("starts empty with no active job", () => {
    expect(getJobs()).toEqual([]);
    expect(getActiveJobId()).toBeNull();
    expect(getActiveJob()).toBeNull();
  });

  it("createJob defaults role/company/stages from interview.config.js", () => {
    const job = createJob({});
    expect(job.role).toBe(APP.role);
    expect(job.company).toBe(APP.company);
    expect(job.status).toBe("active");
    expect(job.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    expect(getJob(job.id)).toEqual(job);
  });

  it("createJob copies stages so edits do not mutate config", () => {
    const job = createJob({});
    job.stages[0].title = "Changed";
    expect(STAGES[0].title).not.toBe("Changed");
  });

  it("accepts explicit fields", () => {
    const job = createJob({ role: "QA Lead", company: "Cursor" });
    expect(job.role).toBe("QA Lead");
    expect(job.company).toBe("Cursor");
  });

  it("updateJob patches and persists", () => {
    const job = createJob({});
    const updated = updateJob(job.id, { company: "NewCo" });
    expect(updated.company).toBe("NewCo");
    expect(getJob(job.id).company).toBe("NewCo");
    expect(updateJob("nope", {})).toBeNull();
  });

  it("active job falls back to the first job when unset or stale", () => {
    const a = createJob({ role: "A" });
    const b = createJob({ role: "B" });
    expect(getActiveJobId()).toBe(a.id);
    setActiveJobId(b.id);
    expect(getActiveJob().role).toBe("B");
    deleteJob(b.id);
    expect(getActiveJobId()).toBe(a.id);
  });

  it("ensureDefaultJob creates one job when none exist, is a no-op otherwise", () => {
    const job = ensureDefaultJob();
    expect(getJobs()).toHaveLength(1);
    expect(getActiveJobId()).toBe(job.id);
    expect(ensureDefaultJob().id).toBe(job.id);
    expect(getJobs()).toHaveLength(1);
  });
});

describe("STAGE_PRESETS", () => {
  it("mirrors STAGES but strips the seed file property", () => {
    expect(STAGE_PRESETS).toHaveLength(STAGES.length);
    expect(STAGE_PRESETS.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    for (const preset of STAGE_PRESETS) {
      expect(preset.file).toBeUndefined();
      expect("file" in preset).toBe(false);
    }
  });
});

describe("isSeedBacked", () => {
  it("is true for a job created from config STAGES (has file props)", () => {
    const job = createJob({});
    expect(isSeedBacked(job)).toBe(true);
  });

  it("is false for a job created from STAGE_PRESETS (no file props)", () => {
    const job = createJob({ stages: STAGE_PRESETS });
    expect(isSeedBacked(job)).toBe(false);
  });

  it("is false for missing/null job", () => {
    expect(isSeedBacked(null)).toBe(false);
    expect(isSeedBacked(undefined)).toBe(false);
  });
});

describe("deleteJobWithData", () => {
  it("purges localStorage keys + IDB rows, and re-points activeJobId when the active job was deleted", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({ role: "A" });
    const b = jobs.createJob({ role: "B" });

    jobs.setActiveJobId(a.id);
    storageSet(`job:${a.id}:flashcards:progress`, { seen: 3 });
    storageSet(`job:${a.id}:context:custom`, ["entry"]);
    await db.addAttempt({ questionId: "q1", transcript: "hi" });
    await db.replaceRecordingForStage("onsite", { fileName: "a.wav" });

    jobs.setActiveJobId(b.id);
    storageSet(`job:${b.id}:flashcards:progress`, { seen: 1 });

    jobs.setActiveJobId(a.id);
    const result = await jobs.deleteJobWithData(a.id);

    expect(result).toEqual({ removedKeys: 2, attempts: 1, recordings: 1 });
    expect(storageGet(`job:${a.id}:flashcards:progress`)).toBeNull();
    expect(storageGet(`job:${a.id}:context:custom`)).toBeNull();
    expect(jobs.getJob(a.id)).toBeNull();
    // Re-pointed to the remaining job since the deleted job was active.
    expect(jobs.getActiveJobId()).toBe(b.id);
    expect(storageGet(`job:${b.id}:flashcards:progress`)).toEqual({ seen: 1 });

    jobs.setActiveJobId(b.id);
    expect(await db.getAllAttempts()).toEqual([]);
    expect(await db.getAllRecordings()).toEqual([]);
  });

  it("removes the activeJobId key entirely when deleting the last remaining job", async () => {
    const { db, jobs } = await freshModules();
    const only = jobs.createJob({ role: "Only" });
    jobs.setActiveJobId(only.id);

    const result = await jobs.deleteJobWithData(only.id);

    expect(result).toEqual({ removedKeys: 0, attempts: 0, recordings: 0 });
    expect(jobs.getJobs()).toEqual([]);
    expect(jobs.getActiveJobId()).toBeNull();
  });

  it("does not touch localStorage keys or IDB rows belonging to other jobs", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({ role: "A" });
    const b = jobs.createJob({ role: "B" });

    jobs.setActiveJobId(a.id);
    await db.addAttempt({ questionId: "q1", transcript: "a1" });

    jobs.setActiveJobId(b.id);
    storageSet(`job:${b.id}:flashcards:progress`, { seen: 5 });
    await db.addAttempt({ questionId: "q1", transcript: "b1" });

    await jobs.deleteJobWithData(a.id);

    expect(jobs.getJob(b.id)).not.toBeNull();
    expect(storageGet(`job:${b.id}:flashcards:progress`)).toEqual({ seen: 5 });
    jobs.setActiveJobId(b.id);
    const remaining = await db.getAllAttempts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].transcript).toBe("b1");
  });
});

describe("exportJob / importJob", () => {
  it("round-trips job + localStorage state under a freshly generated id", () => {
    const source = createJob({ role: "Exporter", company: "ExpCo" });
    storageSet(`job:${source.id}:flashcards:progress`, { seen: 7 });
    storageSet(`job:${source.id}:context:custom`, ["note"]);

    const payload = exportJob(source.id);
    expect(payload.version).toBe(1);
    expect(payload.kind).toBe("iprep-job");
    expect(payload.job.role).toBe("Exporter");
    expect(payload.state).toEqual({
      "flashcards:progress": { seen: 7 },
      "context:custom": ["note"],
    });

    const before = getJobs().length;
    const imported = importJob(payload);

    expect(imported.id).not.toBe(source.id);
    expect(imported.role).toBe("Exporter");
    expect(imported.company).toBe("ExpCo");
    expect(getJobs()).toHaveLength(before + 1);

    // New job's state lives under its own namespace.
    expect(storageGet(`job:${imported.id}:flashcards:progress`)).toEqual({ seen: 7 });
    expect(storageGet(`job:${imported.id}:context:custom`)).toEqual(["note"]);

    // Source job untouched.
    expect(getJob(source.id).role).toBe("Exporter");
    expect(storageGet(`job:${source.id}:flashcards:progress`)).toEqual({ seen: 7 });
  });

  it("does not change the active job", () => {
    const active = createJob({ role: "Active" });
    setActiveJobId(active.id);
    const other = createJob({ role: "ToExport" });
    const payload = exportJob(other.id);

    importJob(payload);

    expect(getActiveJobId()).toBe(active.id);
  });

  it("rejects malformed payloads", () => {
    expect(() => importJob(null)).toThrow("Invalid job export file");
    expect(() => importJob({})).toThrow("Invalid job export file");
    expect(() => importJob({ kind: "iprep-job", version: 2, job: {}, state: {} })).toThrow(
      "Invalid job export file"
    );
    expect(() =>
      importJob({ kind: "iprep-job", version: 1, job: { role: "R" }, state: {} })
    ).toThrow("Invalid job export file"); // missing company
    expect(() =>
      importJob({ kind: "iprep-job", version: 1, job: { role: "R", company: "C" }, state: null })
    ).toThrow("Invalid job export file"); // state not an object
  });

  it("rejects malformed stages", () => {
    const base = { kind: "iprep-job", version: 1, state: {} };
    expect(() =>
      importJob({ ...base, job: { role: "R", company: "C", stages: "not-an-array" } })
    ).toThrow("Invalid job export file");
    expect(() =>
      importJob({ ...base, job: { role: "R", company: "C", stages: [{ id: "x" }] } })
    ).toThrow("Invalid job export file"); // missing title
    expect(() =>
      importJob({ ...base, job: { role: "R", company: "C", stages: [null] } })
    ).toThrow("Invalid job export file");
  });

  it("rejects malformed advisorStarters", () => {
    expect(() =>
      importJob({
        kind: "iprep-job",
        version: 1,
        job: { role: "R", company: "C", advisorStarters: "nope" },
        state: {},
      })
    ).toThrow("Invalid job export file");
  });

  it("imports valid payload with stages omitted, using config defaults", () => {
    const imported = importJob({
      kind: "iprep-job",
      version: 1,
      job: { role: "R", company: "C" },
      state: {},
    });
    expect(imported.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
  });
});

describe("parameterized prompt builders", () => {
  it("buildAdvisorSystem(job) embeds the job's role/company/stage titles", () => {
    const job = {
      role: "Staff Engineer",
      company: "Rocket Inc",
      stages: [
        { id: "s1", title: "Custom Stage One", subtitle: "sub1" },
        { id: "s2", title: "Custom Stage Two", subtitle: "sub2" },
      ],
    };
    const prompt = buildAdvisorSystem(job);
    expect(prompt).toContain("Staff Engineer");
    expect(prompt).toContain("Rocket Inc");
    expect(prompt).toContain("Custom Stage One");
    expect(prompt).toContain("Custom Stage Two");
    expect(prompt).toContain(APP.candidateName);
  });

  it("buildAdvisorSystem() falls back to APP + config STAGES with no job (module-load safety)", () => {
    const prompt = buildAdvisorSystem();
    expect(prompt).toContain(APP.role);
    expect(prompt).toContain(APP.company);
    expect(prompt).toContain(STAGES[0].title);
  });
});
