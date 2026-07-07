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
} from "../jobs.js";
import { APP, STAGES } from "../../../interview.config.js";

beforeEach(() => localStorage.clear());

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
