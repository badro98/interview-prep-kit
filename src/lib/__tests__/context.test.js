import { beforeEach, describe, expect, it } from "vitest";
import {
  getContextFiles,
  getActiveContextBlocks,
  getContext,
} from "../context.js";
import { createJob, setActiveJobId } from "../jobs.js";
import { addCustomContextEntry } from "../store.js";
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
