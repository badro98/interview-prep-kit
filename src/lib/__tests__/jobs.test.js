import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getJobs,
  getJob,
  createJob,
  updateJob,
  attachProfileRef,
  detachProfileRef,
  updateJobStages,
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
import { addProfileEntry } from "../profile.js";
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

// jobs.js has a static import of db.js, so the `?t=` query param does NOT
// rebind it to a fresh db.js module instance (static imports aren't
// cache-busted this way) — jobs and db here still share whatever db.js
// module the test runner already loaded. Isolation instead comes from
// `beforeEach` installing a fresh `new IDBFactory()` per test plus each test
// using freshly generated job ids, so no test can see another test's rows.
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

  it("createJob defaults profileRefs to an empty array", () => {
    const job = createJob({});
    expect(job.profileRefs).toEqual([]);
  });

  it("createJob accepts explicit profileRefs and defensively copies them", () => {
    const refs = ["prof-1", "prof-2"];
    const job = createJob({ profileRefs: refs });
    expect(job.profileRefs).toEqual(["prof-1", "prof-2"]);
    refs.push("prof-3");
    expect(job.profileRefs).toEqual(["prof-1", "prof-2"]);
  });

  it("updateJob patches and persists", () => {
    const job = createJob({});
    const updated = updateJob(job.id, { company: "NewCo" });
    expect(updated.company).toBe("NewCo");
    expect(getJob(job.id).company).toBe("NewCo");
    expect(updateJob("nope", {})).toBeNull();
  });

  it("attachProfileRef appends an entry id once", () => {
    const job = createJob({ profileRefs: ["prof-1"] });
    expect(attachProfileRef(job.id, "prof-2").profileRefs).toEqual(["prof-1", "prof-2"]);
    expect(attachProfileRef(job.id, "prof-2").profileRefs).toEqual(["prof-1", "prof-2"]);
    expect(attachProfileRef("missing", "prof-1")).toBeNull();
  });

  it("detachProfileRef removes an attached id", () => {
    const job = createJob({ profileRefs: ["prof-1", "prof-2"] });
    expect(detachProfileRef(job.id, "prof-1").profileRefs).toEqual(["prof-2"]);
    expect(detachProfileRef(job.id, "prof-1").profileRefs).toEqual(["prof-2"]);
    expect(detachProfileRef("missing", "prof-1")).toBeNull();
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

/** Multi-stage fixture — seed job may be recruiter-only; these tests need several stages. */
const MULTI_STAGES = [
  { id: "recruiter", title: "Recruiter Screen", subtitle: "intro", file: "prep-recruiter.md" },
  { id: "hm", title: "Hiring Manager", subtitle: "behavioral" },
  { id: "takehome", title: "Take-home", subtitle: "exercise" },
  { id: "onsite", title: "Onsite", subtitle: "loop" },
  { id: "final", title: "Final", subtitle: "fit" },
];

describe("updateJobStages", () => {
  it("reorders and renames stages, preserving file props and unrelated overrides", () => {
    const job = createJob({ stages: MULTI_STAGES });
    storageSet(`job:${job.id}:prepdoc:override:hm`, { markdown: "edited", savedAt: 1 });

    const nextStages = [
      { ...job.stages[1], title: "Hiring Manager (Renamed)" }, // hm, renamed
      job.stages[0], // recruiter
      ...job.stages.slice(2),
    ];
    const nextStagesCopy = nextStages.map((s) => ({ ...s }));

    const updated = updateJobStages(job.id, nextStages);

    expect(updated.stages.map((s) => s.id)).toEqual(["hm", "recruiter", "takehome", "onsite", "final"]);
    expect(updated.stages[0].title).toBe("Hiring Manager (Renamed)");
    expect(updated.stages.find((s) => s.id === "recruiter").file).toBe("prep-recruiter.md");
    expect(storageGet(`job:${job.id}:prepdoc:override:hm`)).toEqual({ markdown: "edited", savedAt: 1 });

    // Defensive copy: mutating the input array/objects afterward must not affect the stored job.
    nextStages[0].title = "Mutated";
    expect(getJob(job.id).stages[0].title).toBe("Hiring Manager (Renamed)");
    expect(getJob(job.id).stages).toEqual(nextStagesCopy);
  });

  it("removing a stage deletes its prepdoc override, subpages, recordings flag, and progress entry", () => {
    const job = createJob({ stages: MULTI_STAGES });
    storageSet(`job:${job.id}:prepdoc:override:recruiter`, { markdown: "r", savedAt: 1 });
    storageSet(`job:${job.id}:prepdoc:pages:recruiter`, [{ id: "p1", title: "Notes" }]);
    storageSet(`job:${job.id}:prepdoc:override:hm`, { markdown: "h", savedAt: 2 });
    storageSet(`job:${job.id}:recordings:hasByStage`, { recruiter: true, hm: true });
    storageSet(`job:${job.id}:stages:progress`, {
      recruiter: "complete",
      hm: "in-progress",
      takehome: "upcoming",
    });

    const nextStages = job.stages.filter((s) => s.id !== "recruiter");
    const updated = updateJobStages(job.id, nextStages);

    expect(updated.stages.map((s) => s.id)).not.toContain("recruiter");
    expect(storageGet(`job:${job.id}:prepdoc:override:recruiter`)).toBeNull();
    expect(storageGet(`job:${job.id}:prepdoc:pages:recruiter`)).toBeNull();
    expect(storageGet(`job:${job.id}:prepdoc:override:hm`)).toEqual({ markdown: "h", savedAt: 2 });
    expect(storageGet(`job:${job.id}:recordings:hasByStage`)).toEqual({ hm: true });
    expect(storageGet(`job:${job.id}:stages:progress`)).toEqual({
      hm: "in-progress",
      takehome: "upcoming",
    });
  });

  it("removing the last flagged stage drops the recordings-flag key entirely", () => {
    const job = createJob({ stages: MULTI_STAGES });
    storageSet(`job:${job.id}:recordings:hasByStage`, { recruiter: true });

    const nextStages = job.stages.filter((s) => s.id !== "recruiter");
    updateJobStages(job.id, nextStages);

    expect(storageGet(`job:${job.id}:recordings:hasByStage`)).toBeNull();
  });

  it("adding a stage leaves existing stages' state untouched", () => {
    const job = createJob({ stages: MULTI_STAGES });
    storageSet(`job:${job.id}:prepdoc:override:final`, { markdown: "f", savedAt: 1 });
    storageSet(`job:${job.id}:recordings:hasByStage`, { final: true });

    const nextStages = [...job.stages, { id: "custom1", title: "Custom Stage" }];
    const updated = updateJobStages(job.id, nextStages);

    expect(updated.stages.map((s) => s.id)).toContain("custom1");
    expect(storageGet(`job:${job.id}:prepdoc:override:final`)).toEqual({ markdown: "f", savedAt: 1 });
    expect(storageGet(`job:${job.id}:recordings:hasByStage`)).toEqual({ final: true });
  });

  it("throws on invalid stage shapes", () => {
    const job = createJob({});
    expect(() => updateJobStages(job.id, "not-an-array")).toThrow("Invalid stages");
    expect(() => updateJobStages(job.id, [])).toThrow("Invalid stages"); // empty array invalid
    expect(() => updateJobStages(job.id, [{ id: "x" }])).toThrow("Invalid stages"); // missing title
    expect(() => updateJobStages(job.id, [null])).toThrow("Invalid stages");
    expect(() => updateJobStages(job.id, [{ id: "x", title: "T", subtitle: 5 }])).toThrow(
      "Invalid stages"
    );
  });

  it("throws Job not found for an unknown jobId", () => {
    expect(() => updateJobStages("nope", [{ id: "x", title: "T" }])).toThrow("Job not found");
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

  it("rejects malformed profileRefs", () => {
    expect(() =>
      importJob({
        kind: "iprep-job",
        version: 1,
        job: { role: "R", company: "C", profileRefs: "nope" },
        state: {},
      })
    ).toThrow("Invalid job export file");
    expect(() =>
      importJob({
        kind: "iprep-job",
        version: 1,
        job: { role: "R", company: "C", profileRefs: [1, 2] },
        state: {},
      })
    ).toThrow("Invalid job export file");
  });

  it("filters profileRefs to ids that exist in this browser's profile, dropping dangling refs silently", () => {
    const existing = addProfileEntry({ name: "Resume", content: "..." });

    const imported = importJob({
      kind: "iprep-job",
      version: 1,
      job: { role: "R", company: "C", profileRefs: [existing.id, "prof-dangling"] },
      state: {},
    });

    expect(imported.profileRefs).toEqual([existing.id]);
  });

  it("imports valid payload with profileRefs omitted, defaulting to empty array", () => {
    const imported = importJob({
      kind: "iprep-job",
      version: 1,
      job: { role: "R", company: "C" },
      state: {},
    });
    expect(imported.profileRefs).toEqual([]);
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

  it("buildAdvisorSystem() now requires a job — no more no-arg module-load fallback", () => {
    expect(() => buildAdvisorSystem()).toThrow();
  });

  it("buildAdvisorSystem(job) embeds the config-default job's role/company/stage titles unchanged", () => {
    // Behavioral invariant: the seed-backed default job's prompt output must match
    // what the old no-arg fallback (APP + config STAGES) used to produce.
    const defaultJob = { role: APP.role, company: APP.company, stages: STAGES };
    const prompt = buildAdvisorSystem(defaultJob);
    expect(prompt).toContain(APP.role);
    expect(prompt).toContain(APP.company);
    expect(prompt).toContain(STAGES[0].title);
  });
});

describe("stage id uniqueness", () => {
  it("updateJobStages rejects duplicate stage ids", () => {
    const job = createJob({ role: "QA", company: "Co" });
    expect(() =>
      updateJobStages(job.id, [
        { id: "a", title: "One" },
        { id: "a", title: "Two" },
      ])
    ).toThrow(/Invalid stages/);
  });

  it("importJob rejects payloads with duplicate stage ids", () => {
    expect(() =>
      importJob({
        version: 1,
        kind: "iprep-job",
        job: {
          role: "QA",
          company: "Co",
          stages: [
            { id: "a", title: "One" },
            { id: "a", title: "Two" },
          ],
        },
        state: {},
      })
    ).toThrow(/Invalid job export file/);
  });
});
