// Context loader — profile (shared) + job-only custom entries for coach() and the advisor.
// Repo /context/*.md files are sample-setup seed data: copied once into job-only
// custom entries for seed-backed jobs, not shown as a live source.

import {
  CONTEXT_LABELS,
  CONTEXT_ORDER,
  CONTEXT_SKIP,
} from "../../interview.config.js";
import {
  getDisabledContextFiles,
  getCustomContextEntries,
  getCustomContextEntriesForJob,
  buildCustomContextEntry,
  writeCustomContextEntriesForJob,
  markSeedContextCopied,
  getMergedContextOverridesForJob,
  getDisabledContextFilesForJob,
  setDisabledContextFilesForJob,
} from "./store.js";
import { getActiveJob, getJob, getJobs, isSeedBacked } from "./jobs.js";
import { getProfileEntries } from "./profile.js";

const FILES = import.meta.glob("../../context/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function fileName(path) {
  return path.split("/").pop();
}

/** Bundled /context/*.md files used to seed a sample job. Not a live UI source. */
export function getSeedContextFiles() {
  const entries = Object.entries(FILES)
    .map(([path, content]) => {
      const name = fileName(path);
      if (CONTEXT_SKIP.has(name)) return null;
      return { name, label: CONTEXT_LABELS[name] || name, content: String(content).trim() };
    })
    .filter(Boolean);

  return entries.sort((a, b) => {
    const ia = CONTEXT_ORDER.indexOf(a.name);
    const ib = CONTEXT_ORDER.indexOf(b.name);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** @deprecated Use getSeedContextFiles — kept so older tests/imports keep working. */
export const getContextFiles = getSeedContextFiles;

const PLACEHOLDER_MARKERS = [
  "[YOUR NAME]",
  "[ROLE TITLE]",
  "[COMPANY]",
  "Fill in your tailored resume",
  "[Paste or summarize the official JD",
  "[Project name]",
  "Use this file as a raw dump",
  "[What problem is the team solving?",
  "**Date:** [DATE]",
];

function isSeedPlaceholder(content) {
  const text = String(content || "");
  return PLACEHOLDER_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Materialize seed files into this job's "this job only" list.
 * Copies only real content (local edits / non-placeholder files). Placeholder
 * templates are skipped, and leftover placeholder copies from an earlier pass
 * are removed. Idempotent.
 */
export function copySeedContextToJob(jobId) {
  const job = getJob(jobId);
  if (!isSeedBacked(job)) return { copied: 0, updated: 0, removed: 0 };

  const overrides = getMergedContextOverridesForJob(jobId);
  const disabled = new Set(getDisabledContextFilesForJob(jobId));
  const disabledNext = [...disabled];
  let list = getCustomContextEntriesForJob(jobId);
  let copied = 0;
  let updated = 0;
  let removed = 0;

  for (const file of getSeedContextFiles()) {
    const overrideRaw = overrides[file.name];
    const override = typeof overrideRaw === "string" ? overrideRaw.trim() : "";
    const existing = list.find((e) => e.seedFile === file.name);
    const seedContent = override || file.content;
    const seedIsPlaceholder = isSeedPlaceholder(seedContent);

    if (existing) {
      const existingIsPlaceholder = isSeedPlaceholder(existing.content);
      if (existingIsPlaceholder && override && !isSeedPlaceholder(override)) {
        list = list.map((e) => (e.id === existing.id ? { ...e, content: override } : e));
        updated += 1;
      } else if (existingIsPlaceholder && !override) {
        list = list.filter((e) => e.id !== existing.id);
        removed += 1;
      }
      continue;
    }

    if (seedIsPlaceholder) continue;

    const created = buildCustomContextEntry({
      name: file.label,
      content: seedContent,
      seedFile: file.name,
    });
    list = [...list, created];
    if (disabled.has(file.name)) disabledNext.push(created.id);
    copied += 1;
  }

  writeCustomContextEntriesForJob(jobId, list);
  setDisabledContextFilesForJob(jobId, disabledNext);
  markSeedContextCopied(jobId);
  return { copied, updated, removed };
}

export function copySeedContextForAllJobs() {
  for (const job of getJobs()) copySeedContextToJob(job.id);
}

/**
 * Active context blocks for the agent — profile attachments + job-only custom entries.
 * Returns { name, label, content, source: 'profile'|'custom', enabled, ... }
 */
export function getActiveContextBlocks() {
  const disabled = new Set(getDisabledContextFiles());
  const custom = getCustomContextEntries();

  const profileEntries = getProfileEntries();
  const profileBlocks = (getActiveJob()?.profileRefs || [])
    .map((id) => profileEntries.find((e) => e.id === id))
    .filter(Boolean)
    .map((entry) => ({
      name: entry.id,
      label: entry.name,
      content: entry.content,
      source: "profile",
      enabled: !disabled.has(entry.id),
    }));

  const customBlocks = custom.map((entry) => ({
    name: entry.id,
    customId: entry.id,
    label: entry.name,
    content: entry.content,
    source: "custom",
    enabled: !disabled.has(entry.id),
    sourceUrl: entry.sourceUrl,
    seedFile: entry.seedFile,
  }));

  return [...profileBlocks, ...customBlocks];
}

/** Assembled grounding string for coach() / advisor. */
export function getContext() {
  const blocks = getActiveContextBlocks().filter((b) => b.enabled && b.content?.trim());
  if (!blocks.length) {
    return "(No context loaded — add shared or job-only sources in the Context tab.)";
  }

  const sections = blocks.map((b) => `===== ${b.label} =====\n\n${b.content.trim()}`);

  return [
    "The following is the candidate's full background. Treat it as ground truth.",
    "Use the candidate's REAL stories, metrics, and details — never invent generic examples.",
    "",
    sections.join("\n\n\n"),
  ].join("\n");
}

/**
 * Custom (job-scoped) context grouped by job. Used when adding a new job so
 * previous role notes can be copied or promoted onto the shared profile.
 */
export function listJobsWithCustomContext() {
  return getJobs()
    .map((job) => ({
      jobId: job.id,
      role: job.role,
      company: job.company,
      label: [job.role, job.company].filter(Boolean).join(" — ") || "Untitled job",
      entries: getCustomContextEntriesForJob(job.id),
    }))
    .filter((group) => group.entries.length > 0);
}

/** Summary for the header badge. */
export function getContextSummary() {
  const active = getActiveContextBlocks().filter((b) => b.enabled);
  return {
    count: active.length,
    names: active.map((b) => b.label),
  };
}
