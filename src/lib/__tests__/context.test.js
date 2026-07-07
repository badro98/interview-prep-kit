import { beforeEach, describe, expect, it } from "vitest";
import {
  getContextFiles,
  getActiveContextBlocks,
  getContext,
} from "../context.js";
import { createJob, setActiveJobId } from "../jobs.js";
import { addCustomContextEntry, setContextFileEnabled } from "../store.js";
import { addProfileEntry } from "../profile.js";
import { STAGE_PRESETS } from "../../../interview.config.js";

beforeEach(() => {
  localStorage.clear();
});

// Note: import.meta.glob DOES resolve ../../context/*.md under Vitest (verified
// empirically — getContextFiles() returns the real repo /context files), so these
// assertions check actual content, not just gating behavior.

describe("getContextFiles", () => {
  it("returns the builtin repo files when the active job is seed-backed", () => {
    const job = createJob({}); // default stages (config STAGES) => seed-backed
    setActiveJobId(job.id);

    const files = getContextFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.name === "resume.md")).toBe(true);
  });

  it("returns an empty array when the active job is not seed-backed (preset job)", () => {
    const job = createJob({ stages: STAGE_PRESETS });
    setActiveJobId(job.id);

    expect(getContextFiles()).toEqual([]);
  });

  it("returns an empty array when there is no active job", () => {
    expect(getContextFiles()).toEqual([]);
  });
});

describe("getActiveContextBlocks", () => {
  it("includes builtin + custom blocks for a seed-backed job", () => {
    const job = createJob({});
    setActiveJobId(job.id);

    const blocks = getActiveContextBlocks();
    expect(blocks.some((b) => b.source === "builtin")).toBe(true);
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

  it("includes profile blocks for attached-and-existing refs only, ordered builtin/profile/custom", () => {
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
    expect(profileBlock.label).toBe("Resume (profile)");
    expect(profileBlock.content).toBe("Profile resume content.");
    expect(profileBlock.enabled).toBe(true);

    // Dangling ref (no matching profile entry) is omitted entirely.
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
      "(No context loaded — fill in /context/*.md or add custom entries in the Context tab.)"
    );
  });
});
