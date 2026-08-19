import { beforeEach, describe, expect, it } from "vitest";
import { createJob, setActiveJobId } from "../jobs.js";
import {
  get,
  set,
  getDocOverride,
  setDocOverride,
  setCardProgress,
  getProgressMap,
  addCustomContextEntry,
  getCustomContextEntries,
  getCustomContextEntriesForJob,
  addStagePage,
  getStagePages,
  updateStagePage,
  deleteStagePage,
  ensureStageProgressDefaults,
  setStageProgress,
  getStageProgress,
} from "../store.js";

beforeEach(() => localStorage.clear());

describe("job-scoped store", () => {
  it("prep-doc overrides are isolated per job", () => {
    const a = createJob({ role: "A" });
    const b = createJob({ role: "B" });
    setActiveJobId(a.id);
    setDocOverride("onsite", "# Job A notes");
    expect(getDocOverride("onsite").markdown).toBe("# Job A notes");

    setActiveJobId(b.id);
    expect(getDocOverride("onsite")).toBeNull();

    setActiveJobId(a.id);
    expect(getDocOverride("onsite").markdown).toBe("# Job A notes");
  });

  it("stores optional html alongside markdown on prep-doc override", () => {
    const a = createJob({ role: "A" });
    setActiveJobId(a.id);
    setDocOverride("onsite", "plain", { html: "<p>rich</p>" });
    expect(getDocOverride("onsite")).toMatchObject({
      markdown: "plain",
      html: "<p>rich</p>",
    });
    setDocOverride("onsite", "regenerated");
    expect(getDocOverride("onsite").html).toBeUndefined();
  });

  it("stage subpages are job-scoped and updatable", () => {
    const a = createJob({ role: "A" });
    const b = createJob({ role: "B" });
    setActiveJobId(a.id);
    const page = addStagePage("onsite", { title: "Stories", html: "<p>hi</p>" });
    expect(getStagePages("onsite")).toHaveLength(1);
    updateStagePage("onsite", page.id, { title: "STAR stories" });
    expect(getStagePages("onsite")[0].title).toBe("STAR stories");

    setActiveJobId(b.id);
    expect(getStagePages("onsite")).toEqual([]);

    setActiveJobId(a.id);
    deleteStagePage("onsite", page.id);
    expect(getStagePages("onsite")).toEqual([]);
  });

  it("stores job-scoped keys under job:<id>: prefix", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    setDocOverride("final", "x");
    expect(localStorage.getItem(`iprep:job:${a.id}:prepdoc:override:final`)).toBeTruthy();
  });

  it("flashcard progress and custom context are isolated per job", () => {
    const a = createJob({});
    const b = createJob({});
    setActiveJobId(a.id);
    setCardProgress("card-1", { confidence: 4 });
    addCustomContextEntry({ name: "Intel", content: "notes" });

    setActiveJobId(b.id);
    expect(getProgressMap()).toEqual({});
    expect(getCustomContextEntries()).toEqual([]);

    setActiveJobId(a.id);
    expect(getProgressMap()["card-1"].confidence).toBe(4);
    expect(getCustomContextEntries()).toHaveLength(1);
    expect(getCustomContextEntriesForJob(a.id)).toHaveLength(1);
    expect(getCustomContextEntriesForJob(b.id)).toEqual([]);
  });

  it("raw get/set remain global (job-independent)", () => {
    const a = createJob({});
    const b = createJob({});
    setActiveJobId(a.id);
    set("settings:aiMode", "paste");
    setActiveJobId(b.id);
    expect(get("settings:aiMode")).toBe("paste");
    expect(localStorage.getItem("iprep:settings:aiMode")).toBeTruthy();
  });

  it("does not force the first stage back to in-progress after the user marks it complete", () => {
    const job = createJob({
      stages: [
        { id: "recruiter", title: "Recruiter Screen" },
        { id: "hm", title: "Hiring Manager" },
      ],
    });
    setActiveJobId(job.id);
    const ids = ["recruiter", "hm"];
    ensureStageProgressDefaults(ids);
    expect(getStageProgress("recruiter", ids)).toBe("in-progress");

    setStageProgress("recruiter", "complete");
    ensureStageProgressDefaults(ids);
    expect(getStageProgress("recruiter", ids)).toBe("complete");
    expect(getStageProgress("hm", ids)).toBe("upcoming");
  });
});
