import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations, CURRENT_SCHEMA } from "../migrate.js";
import { getJobs, getActiveJobId, setActiveJobId, createJob } from "../jobs.js";
import { getDocOverride, getProgressMap } from "../store.js";
import * as storage from "../storage.js";
import { APP } from "../../../interview.config.js";

beforeEach(() => localStorage.clear());

describe("runMigrations", () => {
  it("fresh install: creates a default job and stamps the schema version", () => {
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(true);
    expect(getJobs()).toHaveLength(1);
    expect(getActiveJobId()).toBe(jobId);
    expect(getJobs()[0].role).toBe(APP.role);
    expect(storage.get("schemaVersion")).toBe(CURRENT_SCHEMA);
  });

  it("moves legacy flat keys under the default job and deletes the originals", () => {
    localStorage.setItem(
      "iprep:prepdoc:override:onsite",
      JSON.stringify({ markdown: "# my edits", savedAt: 1 })
    );
    localStorage.setItem(
      "iprep:flashcards:progress",
      JSON.stringify({ "card-1": { confidence: 5 } })
    );
    localStorage.setItem("iprep:advisor:chat", JSON.stringify([{ role: "user", content: "hi" }]));
    localStorage.setItem("iprep:mode", JSON.stringify("paste")); // global — untouched

    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(true);

    // Old flat keys gone, new job-scoped keys present.
    expect(localStorage.getItem("iprep:prepdoc:override:onsite")).toBeNull();
    expect(localStorage.getItem("iprep:flashcards:progress")).toBeNull();
    expect(storage.get(`job:${jobId}:advisor:chat`)).toEqual([{ role: "user", content: "hi" }]);
    expect(localStorage.getItem("iprep:mode")).toBe('"paste"');

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

  it("does not create a second job when jobs already exist", () => {
    const job = createJob({ role: "Existing" });
    setActiveJobId(job.id);
    storage.set("schemaVersion", CURRENT_SCHEMA);
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(false);
    expect(jobId).toBe(job.id);
    expect(getJobs()).toHaveLength(1);
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
