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
});
