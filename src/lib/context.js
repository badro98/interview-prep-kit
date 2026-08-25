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

function firstMarkdownHeading(text) {
  return String(text || "").match(/^#\s+(.+)$/m)?.[1] || "";
}

/** Fold filenames like 03_Interview_Stories.md into “interview stories”. */
export function normalizeContextName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/^\d+[._\-\s]+/, "")
    .replace(/[_—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * If `text` (label, title, or first heading) names an existing context source,
 * return that block. Used to stop Advisor from rewriting context as a prep doc.
 */
export function findContextSourceMention(text) {
  const hay = normalizeContextName(text);
  if (hay.length < 6) return null;
  let best = null;
  for (const block of getActiveContextBlocks()) {
    const needles = [block.label, block.name, block.seedFile]
      .map(normalizeContextName)
      .filter((n) => n.length >= 6);
    for (const n of needles) {
      if (hay.includes(n) && (!best || n.length > best.needle.length)) {
        best = { block, needle: n };
      }
    }
  }
  return best?.block || null;
}

/**
 * Detect a prep-doc proposal that is actually a rewrite of a context source
 * (same H1 as a context file, or label/title names that source).
 */
export function findContextDocumentClone(markdown, extraText = "") {
  const heading = firstMarkdownHeading(markdown);
  const headingNorm = normalizeContextName(heading);
  if (headingNorm.length >= 6) {
    for (const block of getActiveContextBlocks()) {
      const blockHeading = normalizeContextName(firstMarkdownHeading(block.content));
      if (blockHeading.length >= 6 && headingNorm === blockHeading) return block;
    }
  }
  return findContextSourceMention(`${extraText}\n${heading}`);
}

export function contextRewriteMessage(block) {
  const name = block?.label || block?.name || "that source";
  if (block?.source === "profile") {
    return `“${name}” is shared context, not a prep doc. Advisor cannot change it — open Context and use Edit.`;
  }
  return `“${name}” is a context source, not a prep doc. Edit it in the Context tab — don’t replace a stage prep doc with it.`;
}

/** Names + shared vs job-only, for the Advisor system prompt. */
export function formatContextInventoryForAdvisor() {
  const blocks = getActiveContextBlocks();
  const parts = [
    "CONTEXT vs PREP DOCS — these are different kits:",
    "- Prep docs are per-stage documents on the Prep Docs tab (Hiring Manager, Recruiter Screen, …). Only those use update_prep_doc / add_stage.",
    "- Context sources are grounding material. Never use update_prep_doc to rewrite them. Shared sources are read-only; tell the user to edit them in the Context tab.",
    "- add_context is only for a NEW this-job-only note (recruiter intel, a pasted page). Never overwrite an existing source.",
  ];
  if (!blocks.length) {
    parts.push("Context sources: (none).");
    return parts.join("\n");
  }
  const line = (b) => `- “${b.label}”${b.enabled ? "" : " (off for this job)"}`;
  const shared = blocks.filter((b) => b.source === "profile");
  const job = blocks.filter((b) => b.source === "custom");
  if (shared.length) {
    parts.push("Shared context (read-only):");
    parts.push(...shared.map(line));
  }
  if (job.length) {
    parts.push("This-job-only context:");
    parts.push(...job.map(line));
  }
  return parts.join("\n");
}

/** Assembled grounding string for coach() / advisor. */
export function getContext() {
  const blocks = getActiveContextBlocks().filter((b) => b.enabled && b.content?.trim());
  if (!blocks.length) {
    return "(No context loaded — add shared or job-only sources in the Context tab.)";
  }

  const sections = blocks.map((b) => {
    const kind = b.source === "profile" ? "shared, read-only" : "this job only";
    return `===== CONTEXT SOURCE (${kind}) · ${b.label} =====\n\n${b.content.trim()}`;
  });

  return [
    "The following is the candidate's full background. Treat it as ground truth.",
    "Use the candidate's REAL stories, metrics, and details — never invent generic examples.",
    "These CONTEXT SOURCES are grounding, not prep docs. Never rewrite them with update_prep_doc.",
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
