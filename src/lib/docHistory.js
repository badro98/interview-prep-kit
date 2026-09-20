// Prep-doc version history. Live docs stay in localStorage; snapshots live in
// IndexedDB so autosave does not blow the quota.

import { markdownToHtml } from "./markdownHtml.js";
import {
  deleteDocVersion,
  deleteDocVersionsForStage,
  getDocVersion,
  listDocVersions,
  putDocVersion,
} from "./db.js";

export const COALESCE_MS = 10 * 60 * 1000;
export const MAX_VERSIONS = 40;
export const ORIGINAL_ID = "original";

export const stageDocKey = (stageId) => `stage:${stageId}`;
export const pageDocKey = (stageId, pageId) => `page:${stageId}:${pageId}`;

const SOURCE_LABELS = {
  edit: "You edited",
  generate: "Generated",
  advisor: "Advisor",
  restore: "Restored",
  original: "Original",
};

export function sourceLabel(version) {
  if (version?.label) return version.label;
  return SOURCE_LABELS[version?.source] || "Saved";
}

export function recordVersionSoon(opts) {
  return recordVersion(opts).catch((err) => {
    console.warn("iprep: could not record prep-doc version", err);
  });
}

/**
 * Snapshot a document. Consecutive unnamed edits within COALESCE_MS update
 * the latest edit row instead of appending.
 */
export async function recordVersion({
  docKey,
  source = "edit",
  html = "",
  markdown = "",
  label,
  now = Date.now(),
}) {
  if (!docKey) return null;
  const bodyHtml = typeof html === "string" && html.trim() ? html : markdownToHtml(markdown || "");
  const bodyMd = typeof markdown === "string" ? markdown : "";

  if (source === "edit" && !label) {
    const existing = await listDocVersions(docKey);
    const latest = existing[0];
    if (
      latest &&
      latest.source === "edit" &&
      !latest.label &&
      now - latest.createdAt < COALESCE_MS
    ) {
      const updated = await putDocVersion({
        ...latest,
        html: bodyHtml,
        markdown: bodyMd,
        createdAt: now,
      });
      await enforceCap(docKey);
      return updated;
    }
  }

  const saved = await putDocVersion({
    docKey,
    source,
    html: bodyHtml,
    markdown: bodyMd,
    createdAt: now,
    ...(label ? { label } : {}),
  });
  await enforceCap(docKey);
  return saved;
}

export async function nameVersion(id, label) {
  const row = await getDocVersion(id);
  if (!row) return null;
  const next = String(label || "").trim();
  const patched = { ...row };
  if (next) patched.label = next;
  else delete patched.label;
  return putDocVersion(patched);
}

/**
 * Snapshot the live doc, then return the version to write forward.
 * Original is virtual (not stored); callers clear the override to apply it.
 */
export async function restoreDoc({
  docKey,
  liveHtml = "",
  liveMarkdown = "",
  versionId,
  original,
}) {
  const now = Date.now();
  await recordVersion({
    docKey,
    source: "edit",
    html: liveHtml,
    markdown: liveMarkdown,
    now,
  });
  const version =
    versionId === ORIGINAL_ID ? original || null : await getDocVersion(versionId);
  if (!version) return null;
  await recordVersion({
    docKey,
    source: "restore",
    html: version.html,
    markdown: version.markdown || "",
    now: now + 1,
  });
  return version;
}

export { listDocVersions, getDocVersion, deleteDocVersionsForStage };

async function enforceCap(docKey) {
  let list = await listDocVersions(docKey);
  while (list.length > MAX_VERSIONS) {
    const newestId = list[0]?.id;
    const oldestFirst = [...list].reverse();
    const drop =
      oldestFirst.find((v) => v.source === "edit" && !v.label && v.id !== newestId) ||
      oldestFirst.find((v) => !v.label && v.id !== newestId);
    if (!drop) break;
    await deleteDocVersion(drop.id);
    list = list.filter((v) => v.id !== drop.id);
  }
}

export function snapshotOriginal({ markdown }) {
  const md = typeof markdown === "string" ? markdown : "";
  return {
    id: ORIGINAL_ID,
    source: "original",
    createdAt: 0,
    html: markdownToHtml(md),
    markdown: md,
  };
}
