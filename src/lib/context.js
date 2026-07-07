// Context loader — reads /context at build time, merges runtime preferences
// (disabled files, content overrides, custom entries) for coach() and the advisor.

import {
  CONTEXT_LABELS,
  CONTEXT_ORDER,
  CONTEXT_SKIP,
} from "../../interview.config.js";
import {
  getDisabledContextFiles,
  getContextOverrides,
  getCustomContextEntries,
} from "./store.js";
import { getActiveJob, isSeedBacked } from "./jobs.js";
import { getProfileEntries } from "./profile.js";

const FILES = import.meta.glob("../../context/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function fileName(path) {
  return path.split("/").pop();
}

/** Raw built-in files from /context (build time). Empty for non-seed-backed jobs. */
export function getContextFiles() {
  if (!isSeedBacked(getActiveJob())) return [];

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

/**
 * Active context blocks for the agent — respects toggles, overrides, and custom entries.
 * Returns { name, label, content, source: 'builtin'|'custom', enabled, hasOverride? }
 */
export function getActiveContextBlocks() {
  const disabled = new Set(getDisabledContextFiles());
  const overrides = getContextOverrides();
  const custom = getCustomContextEntries();

  const builtin = getContextFiles().map((f) => ({
    ...f,
    source: "builtin",
    enabled: !disabled.has(f.name),
    hasOverride: Boolean(overrides[f.name]),
    content: overrides[f.name] ?? f.content,
  }));

  const profileEntries = getProfileEntries();
  const profileBlocks = (getActiveJob()?.profileRefs || [])
    .map((id) => profileEntries.find((e) => e.id === id))
    .filter(Boolean)
    .map((entry) => ({
      name: entry.id,
      label: `${entry.name} (profile)`,
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
  }));

  return [...builtin, ...profileBlocks, ...customBlocks];
}

/** Assembled grounding string for coach() / advisor. */
export function getContext() {
  const blocks = getActiveContextBlocks().filter((b) => b.enabled && b.content?.trim());
  if (!blocks.length) {
    return "(No context loaded — fill in /context/*.md or add custom entries in the Context tab.)";
  }

  const sections = blocks.map(
    (b) => `===== ${b.label}${b.source === "builtin" ? ` (${b.name})` : ""} =====\n\n${b.content.trim()}`
  );

  return [
    "The following is the candidate's full background. Treat it as ground truth.",
    "Use the candidate's REAL stories, metrics, and details — never invent generic examples.",
    "",
    sections.join("\n\n\n"),
  ].join("\n");
}

/** Summary for the header badge. */
export function getContextSummary() {
  const active = getActiveContextBlocks().filter((b) => b.enabled);
  return {
    count: active.length,
    names: active.map((b) => b.label),
  };
}
