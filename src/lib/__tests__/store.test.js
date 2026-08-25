import { beforeEach, describe, expect, it } from "vitest";
import { createJob, setActiveJobId } from "../jobs.js";
import { getDeck } from "../../features/flashcards/deck.js";
import {
  get,
  set,
  getDocOverride,
  setDocOverride,
  setCardProgress,
  getProgressMap,
  addCustomCards,
  getCustomCards,
  setCardStage,
  getStageOverrides,
  setCardCategory,
  getCategoryOverrides,
  deleteCard,
  getHiddenCardIds,
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
  createAdvisorThread,
  getAdvisorThreads,
  saveAdvisorThreadMessages,
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

  it("setCardStage patches custom cards and overrides seed cards", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    addCustomCards([{ id: "c1", question: "Tell me about a conflict.", category: "behavioral" }]);
    setCardStage("c1", "pm_interview");
    expect(getCustomCards()[0].stageId).toBe("pm_interview");
    expect(getStageOverrides()).toEqual({});

    setCardStage("seed-1", "hm");
    expect(getStageOverrides()["seed-1"]).toBe("hm");
    setCardStage("seed-1", null);
    expect(getStageOverrides()["seed-1"]).toBeUndefined();
  });

  it("setCardCategory patches custom cards and overrides seed cards", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    addCustomCards([{ id: "c1", question: "Conflict?", category: "behavioral" }]);
    setCardCategory("c1", "situational");
    expect(getCustomCards()[0].category).toBe("situational");
    expect(getCategoryOverrides()).toEqual({});
    expect(getDeck().find((c) => c.id === "c1")?.category).toBe("situational");

    setCardCategory("seed-1", "role-specific");
    expect(getCategoryOverrides()["seed-1"]).toBe("role-specific");
  });

  it("deleteCard removes custom cards and hides seed cards", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    addCustomCards([{ id: "c1", question: "Conflict?", category: "behavioral" }]);
    expect(getDeck().some((c) => c.id === "c1")).toBe(true);
    deleteCard("c1");
    expect(getCustomCards()).toEqual([]);
    expect(getHiddenCardIds()).toContain("c1");
    expect(getDeck().some((c) => c.id === "c1")).toBe(false);

    deleteCard("seed-1");
    expect(getHiddenCardIds()).toEqual(expect.arrayContaining(["c1", "seed-1"]));
    expect(getDeck().some((c) => c.id === "seed-1")).toBe(false);
  });

  it("setCardProgress can skip bumping lastReviewed when projecting", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    setCardProgress("card-1", { confidence: 2, lastReviewed: 100 });
    const before = getProgressMap()["card-1"].lastReviewed;
    expect(before).toBeGreaterThan(100);
    setCardProgress("card-1", { myAnswer: "hi", lastReviewed: 50 }, { touch: false });
    expect(getProgressMap()["card-1"].lastReviewed).toBe(50);
    expect(getProgressMap()["card-1"].myAnswer).toBe("hi");
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

describe("advisor threads", () => {
  beforeEach(() => {
    const job = createJob({ role: "A" });
    setActiveJobId(job.id);
  });

  it("does not bump updatedAt when re-saving the same messages", () => {
    const thread = createAdvisorThread();
    const stamp = getAdvisorThreads().find((t) => t.id === thread.id).updatedAt;
    saveAdvisorThreadMessages(thread.id, thread.messages);
    expect(getAdvisorThreads().find((t) => t.id === thread.id).updatedAt).toBe(stamp);
  });

  it("bumps updatedAt when messages change", () => {
    const older = createAdvisorThread();
    const newer = createAdvisorThread();
    expect(getAdvisorThreads()[0].id).toBe(newer.id);

    saveAdvisorThreadMessages(older.id, [
      { role: "user", content: "hello", at: Date.now() },
    ]);
    expect(getAdvisorThreads()[0].id).toBe(older.id);
  });
});
