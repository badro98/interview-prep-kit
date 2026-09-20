import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetDbConnection, deleteJobRecords } from "../db.js";
import { createJob, setActiveJobId } from "../jobs.js";
import {
  COALESCE_MS,
  MAX_VERSIONS,
  ORIGINAL_ID,
  listDocVersions,
  nameVersion,
  pageDocKey,
  recordVersion,
  restoreDoc,
  snapshotOriginal,
  stageDocKey,
} from "../docHistory.js";

let activeJob;

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  _resetDbConnection();
  activeJob = createJob({ role: "Tester" });
  setActiveJobId(activeJob.id);
});

describe("recordVersion", () => {
  it("coalesces unnamed edits inside the window into one row", async () => {
    const docKey = stageDocKey("onsite");
    const first = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>a</p>",
      markdown: "a",
      now: 1_000,
    });
    const second = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>b</p>",
      markdown: "b",
      now: 1_000 + 60_000,
    });

    expect(second.id).toBe(first.id);
    expect(second.markdown).toBe("b");
    const list = await listDocVersions(docKey);
    expect(list).toHaveLength(1);
  });

  it("appends a new row after the coalesce window", async () => {
    const docKey = stageDocKey("onsite");
    const first = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>a</p>",
      markdown: "a",
      now: 1_000,
    });
    const later = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>c</p>",
      markdown: "c",
      now: 1_000 + COALESCE_MS + 1,
    });

    expect(later.id).not.toBe(first.id);
    expect(await listDocVersions(docKey)).toHaveLength(2);
  });

  it("always appends generate even inside the edit window", async () => {
    const docKey = stageDocKey("onsite");
    await recordVersion({
      docKey,
      source: "edit",
      html: "<p>a</p>",
      markdown: "a",
      now: 1_000,
    });
    await recordVersion({
      docKey,
      source: "generate",
      html: "<p>gen</p>",
      markdown: "gen",
      now: 2_000,
    });

    const list = await listDocVersions(docKey);
    expect(list).toHaveLength(2);
    expect(list[0].source).toBe("generate");
  });

  it("does not coalesce a named edit", async () => {
    const docKey = stageDocKey("onsite");
    const named = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>a</p>",
      markdown: "a",
      now: 1_000,
    });
    await nameVersion(named.id, "Before rewrite");
    const next = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>b</p>",
      markdown: "b",
      now: 2_000,
    });

    expect(next.id).not.toBe(named.id);
    expect(await listDocVersions(docKey)).toHaveLength(2);
  });
});

describe("cap", () => {
  it("drops oldest unnamed edits first and keeps the newest", async () => {
    const docKey = stageDocKey("cap");
    for (let i = 0; i < MAX_VERSIONS + 2; i++) {
      await recordVersion({
        docKey,
        source: "edit",
        html: `<p>${i}</p>`,
        markdown: String(i),
        now: 1_000 + i * (COALESCE_MS + 1),
      });
    }

    const list = await listDocVersions(docKey);
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0].markdown).toBe(String(MAX_VERSIONS + 1));
    expect(list.some((v) => v.markdown === "0")).toBe(false);
  });

  it("never drops a named version to make room", async () => {
    const docKey = stageDocKey("named-cap");
    const named = await recordVersion({
      docKey,
      source: "edit",
      html: "<p>keep</p>",
      markdown: "keep",
      now: 1,
    });
    await nameVersion(named.id, "Keep me");

    for (let i = 0; i < MAX_VERSIONS; i++) {
      await recordVersion({
        docKey,
        source: "edit",
        html: `<p>${i}</p>`,
        markdown: String(i),
        now: 10_000 + i * (COALESCE_MS + 1),
      });
    }

    const list = await listDocVersions(docKey);
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list.some((v) => v.label === "Keep me")).toBe(true);
  });
});

describe("keys and original", () => {
  it("keeps subpage history independent of the parent stage doc", async () => {
    const stageKey = stageDocKey("onsite");
    const pageKey = pageDocKey("onsite", "page-1");
    await recordVersion({
      docKey: stageKey,
      source: "edit",
      html: "<p>stage</p>",
      markdown: "stage",
    });
    await recordVersion({
      docKey: pageKey,
      source: "advisor",
      html: "<p>page</p>",
      markdown: "page",
    });

    expect(await listDocVersions(stageKey)).toHaveLength(1);
    expect(await listDocVersions(pageKey)).toHaveLength(1);
    expect((await listDocVersions(stageKey))[0].markdown).toBe("stage");
    expect((await listDocVersions(pageKey))[0].markdown).toBe("page");
  });

  it("treats Original as a virtual snapshot, not a stored row", async () => {
    const orig = snapshotOriginal({ markdown: "# Seed" });
    expect(orig.id).toBe(ORIGINAL_ID);
    expect(orig.source).toBe("original");
    expect(await listDocVersions(stageDocKey("onsite"))).toEqual([]);
  });
});

describe("restoreDoc", () => {
  it("snapshots current content then returns the chosen version", async () => {
    const docKey = stageDocKey("onsite");
    const mid = await recordVersion({
      docKey,
      source: "generate",
      html: "<p>mid</p>",
      markdown: "mid",
      now: 1_000,
    });
    await recordVersion({
      docKey,
      source: "edit",
      html: "<p>later</p>",
      markdown: "later",
      now: 1_000 + COALESCE_MS + 1,
    });

    const restored = await restoreDoc({
      docKey,
      liveHtml: "<p>now</p>",
      liveMarkdown: "now",
      versionId: mid.id,
    });

    expect(restored.markdown).toBe("mid");
    const list = await listDocVersions(docKey);
    expect(list[0].source).toBe("restore");
    expect(list.some((v) => v.markdown === "now" || v.html.includes("now"))).toBe(true);
  });

  it("original restore returns the seed snapshot so callers can clear the override", async () => {
    const docKey = stageDocKey("onsite");
    const original = snapshotOriginal({ markdown: "# Seed" });
    const restored = await restoreDoc({
      docKey,
      liveHtml: "<p>mine</p>",
      liveMarkdown: "mine",
      versionId: ORIGINAL_ID,
      original,
    });

    expect(restored.id).toBe(ORIGINAL_ID);
    expect(restored.markdown).toBe("# Seed");
    const list = await listDocVersions(docKey);
    expect(list.some((v) => v.markdown === "mine")).toBe(true);
    expect(list.some((v) => v.source === "restore")).toBe(true);
    expect(list.some((v) => v.id === ORIGINAL_ID)).toBe(false);
  });
});

describe("job purge", () => {
  it("deleteJobRecords removes that job's versions only", async () => {
    const docKey = stageDocKey("onsite");
    await recordVersion({
      docKey,
      source: "edit",
      html: "<p>a</p>",
      markdown: "a",
    });
    const jobA = activeJob;
    const jobB = createJob({ role: "Other" });
    setActiveJobId(jobB.id);
    await recordVersion({
      docKey,
      source: "edit",
      html: "<p>b</p>",
      markdown: "b",
    });

    const result = await deleteJobRecords(jobA.id);
    expect(result.versions).toBe(1);

    setActiveJobId(jobA.id);
    expect(await listDocVersions(docKey)).toEqual([]);

    setActiveJobId(jobB.id);
    expect(await listDocVersions(docKey)).toHaveLength(1);
  });
});
