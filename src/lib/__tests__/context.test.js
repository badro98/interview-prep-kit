import { beforeEach, describe, expect, it } from "vitest";
import {
  getSeedContextFiles,
  getActiveContextBlocks,
  getContext,
  listJobsWithCustomContext,
  copySeedContextToJob,
} from "../context.js";
import { createJob, setActiveJobId } from "../jobs.js";
import {
  addCustomContextEntry,
  getCustomContextEntries,
  getCustomContextEntriesForJob,
  setContextFileEnabled,
  setContextOverride,
  hasCopiedSeedContext,
} from "../store.js";
import { addProfileEntry } from "../profile.js";
import { STAGE_PRESETS } from "../../../interview.config.js";

beforeEach(() => {
  localStorage.clear();
});

describe("getSeedContextFiles", () => {
  it("returns the bundled repo files regardless of the active job", () => {
    const files = getSeedContextFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.name === "resume.md")).toBe(true);
    expect(files.some((f) => f.name === "experiences.md")).toBe(true);
  });
});

describe("copySeedContextToJob", () => {
  it("does not copy placeholder templates when there are no local edits", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const { copied, removed } = copySeedContextToJob(job.id);
    expect(copied).toBe(0);
    expect(removed).toBe(0);
    expect(hasCopiedSeedContext(job.id)).toBe(true);
    expect(getCustomContextEntries()).toEqual([]);
  });

  it("copies local overrides (real edits) and skips remaining placeholders", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    setContextOverride("resume.md", "Tailored MDCalc resume.");
    const { copied } = copySeedContextToJob(job.id);
    expect(copied).toBe(1);

    const entries = getCustomContextEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].seedFile).toBe("resume.md");
    expect(entries[0].content).toBe("Tailored MDCalc resume.");
  });

  it("replaces a leftover placeholder copy with the saved override", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    addCustomContextEntry({
      name: "Resume / background",
      content: "# Resume — [YOUR NAME]\nFill in your tailored resume.",
      seedFile: "resume.md",
    });
    setContextOverride("resume.md", "Osama resume for MDCalc.");

    const { updated } = copySeedContextToJob(job.id);
    expect(updated).toBe(1);
    expect(getCustomContextEntries()[0].content).toBe("Osama resume for MDCalc.");
  });

  it("removes leftover placeholder copies when there is no override", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    addCustomContextEntry({
      name: "Resume / background",
      content: "Fill in your tailored resume. [YOUR NAME]",
      seedFile: "resume.md",
    });
    addCustomContextEntry({ name: "My real JD", content: "Actual MDCalc posting." });

    const { removed } = copySeedContextToJob(job.id);
    expect(removed).toBe(1);
    expect(getCustomContextEntries().map((e) => e.name)).toEqual(["My real JD"]);
  });

  it("is a no-op for non-seed jobs", () => {
    const preset = createJob({ stages: STAGE_PRESETS });
    expect(copySeedContextToJob(preset.id)).toEqual({ copied: 0, updated: 0, removed: 0 });
    expect(getCustomContextEntriesForJob(preset.id)).toEqual([]);
  });
});

describe("getActiveContextBlocks", () => {
  it("does not expose builtin files as a live source", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    expect(getActiveContextBlocks().some((b) => b.source === "builtin")).toBe(false);
  });

  it("includes only custom entries (no builtin) for a non-seed preset job", () => {
    const job = createJob({ stages: STAGE_PRESETS });
    setActiveJobId(job.id);
    addCustomContextEntry({ name: "My note", content: "Some custom context." });

    const blocks = getActiveContextBlocks();
    expect(blocks.every((b) => b.source === "custom")).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("My note");
  });

  it("includes profile blocks for attached-and-existing refs only, ordered profile then custom", () => {
    const entry = addProfileEntry({ name: "Resume", content: "Profile resume content." });
    const job = createJob({
      stages: STAGE_PRESETS,
      profileRefs: [entry.id, "prof-dangling"],
    });
    setActiveJobId(job.id);
    addCustomContextEntry({ name: "My note", content: "Some custom context." });

    const blocks = getActiveContextBlocks();
    expect(blocks.map((b) => b.source)).toEqual(["profile", "custom"]);

    const profileBlock = blocks.find((b) => b.source === "profile");
    expect(profileBlock.name).toBe(entry.id);
    expect(profileBlock.label).toBe("Resume");
    expect(profileBlock.content).toBe("Profile resume content.");
    expect(profileBlock.enabled).toBe(true);

    expect(blocks.some((b) => b.name === "prof-dangling")).toBe(false);
  });

  it("per-job disable of a profile block does not affect another job with the same ref attached", () => {
    const entry = addProfileEntry({ name: "Resume", content: "Shared resume." });
    const jobA = createJob({ stages: STAGE_PRESETS, profileRefs: [entry.id] });
    const jobB = createJob({ stages: STAGE_PRESETS, profileRefs: [entry.id] });

    setActiveJobId(jobA.id);
    setContextFileEnabled(entry.id, false);
    expect(getActiveContextBlocks().find((b) => b.name === entry.id).enabled).toBe(false);

    setActiveJobId(jobB.id);
    expect(getActiveContextBlocks().find((b) => b.name === entry.id).enabled).toBe(true);
  });
});

describe("getContext", () => {
  it("keeps the existing empty-state string when no blocks are active", () => {
    const job = createJob({ stages: STAGE_PRESETS });
    setActiveJobId(job.id);

    expect(getContext()).toBe(
      "(No context loaded — add shared or job-only sources in the Context tab.)"
    );
  });

  it("labels shared context as a read-only grounding source", () => {
    const entry = addProfileEntry({
      name: "03_Interview_Stories",
      content: "# Osama Badr — Interview Stories\n\nSTAR stories.",
    });
    const job = createJob({ stages: STAGE_PRESETS, profileRefs: [entry.id] });
    setActiveJobId(job.id);

    const text = getContext();
    expect(text).toContain("CONTEXT SOURCE (shared, read-only) · 03_Interview_Stories");
    expect(text).toContain("Never rewrite them with update_prep_doc");
  });
});

describe("listJobsWithCustomContext", () => {
  it("groups job-scoped custom entries without switching the active job", () => {
    const jobA = createJob({ role: "Staff QA", company: "Loop", stages: STAGE_PRESETS });
    const jobB = createJob({ role: "EM", company: "Acme", stages: STAGE_PRESETS });
    setActiveJobId(jobA.id);
    addCustomContextEntry({ name: "Stories", content: "Impact stories." });
    addCustomContextEntry({ name: "Job description", content: "Loop JD." });

    setActiveJobId(jobB.id);
    addCustomContextEntry({ name: "Tailored resume", content: "Acme resume." });

    const groups = listJobsWithCustomContext();
    expect(groups.map((g) => g.jobId).sort()).toEqual([jobA.id, jobB.id].sort());

    const loop = groups.find((g) => g.jobId === jobA.id);
    expect(loop.label).toBe("Staff QA — Loop");
    expect(loop.entries.map((e) => e.name)).toEqual(["Stories", "Job description"]);
    expect(getCustomContextEntriesForJob(jobA.id).map((e) => e.name)).toEqual([
      "Stories",
      "Job description",
    ]);

    setActiveJobId(jobB.id);
    expect(getCustomContextEntriesForJob(jobA.id)).toHaveLength(2);
  });

  it("omits jobs that have no custom context", () => {
    createJob({ role: "Empty", company: "None", stages: STAGE_PRESETS });
    expect(listJobsWithCustomContext()).toEqual([]);
  });
});
