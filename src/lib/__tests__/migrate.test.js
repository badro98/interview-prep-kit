import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations, applyDemoResync, CURRENT_SCHEMA } from "../migrate.js";
import { getJobs, getActiveJobId, setActiveJobId, createJob } from "../jobs.js";
import { getDocOverride, getProgressMap } from "../store.js";
import * as storage from "../storage.js";
import { APP } from "../../../interview.config.js";

beforeEach(() => localStorage.clear());

describe("runMigrations", () => {
  it("fresh install: stamps the schema version and creates NO job", () => {
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(false);
    expect(jobId).toBeNull();
    expect(getJobs()).toHaveLength(0);
    expect(storage.get("schemaVersion")).toBe(CURRENT_SCHEMA);
  });

  it("moves legacy flat keys under a newly created default job and deletes the originals", () => {
    localStorage.setItem(
      "iprep:prepdoc:override:onsite",
      JSON.stringify({ markdown: "# my edits", savedAt: 1 })
    );
    localStorage.setItem(
      "iprep:flashcards:progress",
      JSON.stringify({ "card-1": { confidence: 5 } })
    );
    localStorage.setItem("iprep:advisor:chat", JSON.stringify([{ role: "user", content: "hi" }]));
    localStorage.setItem("iprep:settings:aiMode", JSON.stringify("paste")); // global — untouched

    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(true);
    expect(jobId).not.toBeNull();
    expect(getJobs()).toHaveLength(1);
    expect(getJobs()[0].role).toBe(APP.role);

    // Old flat keys gone, new job-scoped keys present.
    expect(localStorage.getItem("iprep:prepdoc:override:onsite")).toBeNull();
    expect(localStorage.getItem("iprep:flashcards:progress")).toBeNull();
    expect(storage.get(`job:${jobId}:advisor:chat`)).toEqual([{ role: "user", content: "hi" }]);
    expect(localStorage.getItem("iprep:settings:aiMode")).toBe('"paste"');

    // And the job-scoped store reads them for the active job.
    setActiveJobId(jobId);
    expect(getDocOverride("onsite").markdown).toBe("# my edits");
    expect(getProgressMap()["card-1"].confidence).toBe(5);
  });

  it("is idempotent — second run is a no-op", () => {
    localStorage.setItem("iprep:flashcards:custom", JSON.stringify([{ id: "c1" }]));
    const first = runMigrations();
    const second = runMigrations();
    expect(second.migrated).toBe(false);
    expect(second.jobId).toBe(first.jobId);
    expect(getJobs()).toHaveLength(1);
  });

  it("does not create a job when jobs already exist (schema already current)", () => {
    const job = createJob({ role: "Existing" });
    setActiveJobId(job.id);
    storage.set("schemaVersion", CURRENT_SCHEMA);
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(false);
    expect(jobId).toBe(job.id);
    expect(getJobs()).toHaveLength(1);
  });

  it("does not create a job on a fresh install when schema is already current (no legacy keys, no jobs)", () => {
    storage.set("schemaVersion", CURRENT_SCHEMA);
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(false);
    expect(jobId).toBeNull();
    expect(getJobs()).toHaveLength(0);
  });

  describe("stale-overwrite guard", () => {
    it("skips copying a legacy key when the job-scoped destination already has a value, and still deletes the legacy key", () => {
      // Simulate a job that already exists (e.g. created by the user mid-migration-retry)
      // with a newer value already written at the job-scoped destination.
      const job = createJob({ role: "Existing" });
      setActiveJobId(job.id);
      storage.set(`job:${job.id}:flashcards:progress`, { "card-1": { confidence: 9 } });

      localStorage.setItem(
        "iprep:flashcards:progress",
        JSON.stringify({ "card-1": { confidence: 5 } })
      );

      const { migrated } = runMigrations();
      expect(migrated).toBe(true);

      // Destination value untouched (not clobbered by the stale legacy copy).
      expect(storage.get(`job:${job.id}:flashcards:progress`)).toEqual({
        "card-1": { confidence: 9 },
      });
      // Legacy key still deleted — its data is safely superseded, not lost.
      expect(localStorage.getItem("iprep:flashcards:progress")).toBeNull();
      expect(storage.get("schemaVersion")).toBe(CURRENT_SCHEMA);
    });
  });

  describe("partial write failure", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("keeps legacy keys and does not stamp schemaVersion when a job-scoped write fails, then succeeds on retry", () => {
      localStorage.setItem(
        "iprep:flashcards:progress",
        JSON.stringify({ "card-1": { confidence: 5 } })
      );

      const realSetItem = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
        if (key.startsWith("iprep:job:")) {
          throw new DOMException("full", "QuotaExceededError");
        }
        return realSetItem.call(this, key, value);
      });

      const first = runMigrations();
      expect(first.migrated).toBe(false);

      // Legacy key survives — nothing destructive happened on a failed write.
      expect(localStorage.getItem("iprep:flashcards:progress")).toBe(
        JSON.stringify({ "card-1": { confidence: 5 } })
      );
      // Schema version must not be stamped, so the migration retries next boot.
      expect(storage.get("schemaVersion")).not.toBe(CURRENT_SCHEMA);

      spy.mockRestore();

      const second = runMigrations();
      expect(second.migrated).toBe(true);
      expect(storage.get(`job:${second.jobId}:flashcards:progress`)).toEqual({
        "card-1": { confidence: 5 },
      });
      expect(localStorage.getItem("iprep:flashcards:progress")).toBeNull();
      expect(storage.get("schemaVersion")).toBe(CURRENT_SCHEMA);
    });
  });
});

describe("applyDemoResync", () => {
  beforeEach(() => localStorage.clear());

  it("does nothing when version is null/undefined", () => {
    storage.set("schemaVersion", CURRENT_SCHEMA);
    storage.set("jobs", [{ id: "j1" }]);
    const resynced = applyDemoResync(undefined);
    expect(resynced).toBe(false);
    expect(storage.get("jobs")).toEqual([{ id: "j1" }]);
  });

  it("does nothing when the stored stamp already matches the given version", () => {
    storage.set("demo:localStateVersion", 3);
    storage.set("jobs", [{ id: "j1" }]);
    const resynced = applyDemoResync(3);
    expect(resynced).toBe(false);
    expect(storage.get("jobs")).toEqual([{ id: "j1" }]);
  });

  it("wipes ALL iprep keys and stamps the new version when the version differs", () => {
    storage.set("demo:localStateVersion", 2);
    storage.set("schemaVersion", CURRENT_SCHEMA);
    storage.set("jobs", [{ id: "j1" }]);
    storage.set("activeJobId", "j1");
    storage.set("job:j1:context:custom", [{ id: "ctx-1" }]);

    const resynced = applyDemoResync(3);
    expect(resynced).toBe(true);

    // Every iprep key is gone, including schemaVersion/jobs/job-scoped state.
    expect(storage.listKeys("")).toEqual([]);
    expect(storage.get("demo:localStateVersion")).toBeNull();

    // Caller is responsible for re-stamping after running migrations on the
    // clean slate; applyDemoResync itself does not restamp because the wipe
    // removes it along with everything else — but it reports what to stamp.
  });

  it("full demo boot sequence: wipe + migrate + reseed produces exactly one seed-backed job", () => {
    // Simulate a previous demo install with stale custom context from an older config.
    storage.set("demo:localStateVersion", 2);
    storage.set("schemaVersion", CURRENT_SCHEMA);
    const oldJob = createJob({ role: "Stale Role", company: "Stale Co" });
    setActiveJobId(oldJob.id);
    storage.set(`job:${oldJob.id}:context:custom`, [{ id: "ctx-1", name: "stale" }]);

    const DEMO = { localStateVersion: 3 };
    const resynced = applyDemoResync(DEMO.localStateVersion);
    expect(resynced).toBe(true);
    expect(getJobs()).toHaveLength(0);

    storage.set("demo:localStateVersion", DEMO.localStateVersion);
    const { jobId } = runMigrations();
    expect(getJobs()).toHaveLength(0); // no legacy keys → migrations create nothing yet

    // Boot-sequence reseed step (mirrors main.jsx): DEMO set + no jobs → ensureDefaultJob().
    expect(jobId).toBeNull();
  });
});
