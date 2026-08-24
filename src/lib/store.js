// State helpers on top of the storage adapter (src/lib/storage.js).
//
// Two scopes:
//   - GLOBAL: raw get/set/remove re-exported below — settings like AI mode.
//   - JOB-SCOPED: everything else in this file belongs to the ACTIVE job and
//     is stored under job:<activeJobId>:<key>. Feature code never sees the
//     prefix; switching the active job switches all of this state.
//
// Big binary data (audio blobs) goes to IndexedDB (db.js), not here.

import * as storage from "./storage.js";
import { getActiveJobId } from "./jobs.js";

export const get = storage.get;
export const set = storage.set;
export const remove = storage.remove;

const jobKey = (key) => `job:${getActiveJobId() || "none"}:${key}`;
const jget = (key, fallback = null) => storage.get(jobKey(key), fallback);
const jset = (key, value) => storage.set(jobKey(key), value);
const jremove = (key) => storage.remove(jobKey(key));

// ---- Per-stage prep-doc state -------------------------------------------------

const overrideKey = (stageId) => `prepdoc:override:${stageId}`;

/**
 * The editable doc body for a stage. Inline edits and regenerations both write
 * here, replacing the build-time markdown. Stored as { markdown, html?, savedAt }.
 * `html` is the rich-editor source of truth when present; `markdown` remains
 * for generate/advisor writes and as a fallback. Returns null when the user
 * hasn't edited/regenerated (so the original shows).
 */
export const getDocOverride = (stageId) => jget(overrideKey(stageId), null);
export function setDocOverride(stageId, markdown, extra = {}) {
  const rec = { markdown, savedAt: Date.now() };
  if (typeof extra.html === "string") rec.html = extra.html;
  jset(overrideKey(stageId), rec);
}
export const clearDocOverride = (stageId) => jremove(overrideKey(stageId));

// ---- Per-stage subpages (extra titled docs under a stage) --------------------

const pagesKey = (stageId) => `prepdoc:pages:${stageId}`;

function newPageId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function getStagePages(stageId) {
  const pages = jget(pagesKey(stageId), []);
  return Array.isArray(pages) ? pages : [];
}

function writeStagePages(stageId, pages) {
  jset(pagesKey(stageId), pages);
  return pages;
}

export function addStagePage(stageId, { title = "Untitled page", html = "<p></p>" } = {}) {
  const page = {
    id: newPageId(),
    title: String(title || "Untitled page").trim() || "Untitled page",
    html: typeof html === "string" && html.trim() ? html : "<p></p>",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeStagePages(stageId, [...getStagePages(stageId), page]);
  return page;
}

export function updateStagePage(stageId, pageId, patch) {
  const pages = getStagePages(stageId);
  const next = pages.map((p) =>
    p.id === pageId ? { ...p, ...patch, id: p.id, updatedAt: Date.now() } : p
  );
  writeStagePages(stageId, next);
  return next.find((p) => p.id === pageId) || null;
}

export function deleteStagePage(stageId, pageId) {
  writeStagePages(
    stageId,
    getStagePages(stageId).filter((p) => p.id !== pageId)
  );
}

export function clearStagePages(stageId) {
  jremove(pagesKey(stageId));
}

// ---- Flashcard state ----------------------------------------------------------
//
// Per-card progress is stored as one map keyed by card id:
//   { [cardId]: { myAnswer, aiCoaching, confidence, lastReviewed } }
// User-generated cards (from "generate more") live in a separate array so the
// build-time seed deck stays clean.

const PROGRESS_KEY = "flashcards:progress";
const CUSTOM_KEY = "flashcards:custom";

export const getProgressMap = () => jget(PROGRESS_KEY, {});

/**
 * Merge a partial progress object into a card's existing progress.
 * Pass `{ touch: false }` when projecting an attempt so merely opening a card
 * does not bump lastReviewed / weakest-first order.
 */
export function setCardProgress(cardId, partial, { touch = true } = {}) {
  const map = getProgressMap();
  const next = { ...(map[cardId] || {}), ...partial };
  if (touch) next.lastReviewed = Date.now();
  map[cardId] = next;
  jset(PROGRESS_KEY, map);
  return map[cardId];
}

export const getCustomCards = () => jget(CUSTOM_KEY, []);

/** Append new custom cards, de-duped by id. Returns how many were added. */
export function addCustomCards(cards) {
  const existing = getCustomCards();
  const seen = new Set(existing.map((c) => c.id));
  const additions = cards.filter((c) => c && c.id && !seen.has(c.id));
  if (additions.length) jset(CUSTOM_KEY, [...existing, ...additions]);
  return additions.length;
}

// Per-card overrides for the gold-standard model answer (referenceAnswer + keyPoints).
// Seed JSON stays untouched; edits live here until reset.

const MODEL_KEY = "flashcards:modelOverrides";

export const getModelOverrides = () => jget(MODEL_KEY, {});

export function setModelOverride(cardId, { referenceAnswer, keyPoints }) {
  const map = getModelOverrides();
  map[cardId] = {
    referenceAnswer,
    keyPoints: Array.isArray(keyPoints) ? keyPoints : [],
    savedAt: Date.now(),
  };
  jset(MODEL_KEY, map);
  return map[cardId];
}

export function clearModelOverride(cardId) {
  const map = getModelOverrides();
  delete map[cardId];
  jset(MODEL_KEY, map);
}

// ---- Context preferences (advisor + all coach() calls) ----------------------
//
// Custom entries are job-scoped notes. Seed files from /context/*.md are copied
// into custom entries once per seed-backed job (see copySeedContextToJob).

const CONTEXT_DISABLED_KEY = "context:disabled"; // string[] of entry ids (and legacy filenames)
const CONTEXT_OVERRIDES_KEY = "context:overrides"; // { [filename]: markdown } — used when copying seed files
const CONTEXT_CUSTOM_KEY = "context:custom"; // { id, name, content, enabled, seedFile? }[]
const CONTEXT_SEED_COPIED_KEY = "context:seedCopied";
const ADVISOR_THREADS_KEY = "advisor:threads";
const ADVISOR_ACTIVE_KEY = "advisor:activeThreadId";
const LEGACY_CHAT_KEY = "advisor:chat";

function threadTitleFromMessage(text) {
  const oneLine = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!oneLine) return "New chat";
  return oneLine.length > 52 ? `${oneLine.slice(0, 49)}…` : oneLine;
}

function autoThreadTitle(messages) {
  const first = (messages || []).find(
    (m) => m.role === "user" && !m.isSystemNote && m.content?.trim()
  );
  return first ? threadTitleFromMessage(first.content) : "New chat";
}

function migrateLegacyAdvisorChat() {
  const legacy = jget(LEGACY_CHAT_KEY, null);
  if (!legacy || !Array.isArray(legacy) || legacy.length === 0) return null;
  const now = Date.now();
  const thread = {
    id: `thread-${now}`,
    title: autoThreadTitle(legacy),
    createdAt: legacy[0]?.at || now,
    updatedAt: legacy[legacy.length - 1]?.at || now,
    messages: legacy,
  };
  jset(ADVISOR_THREADS_KEY, [thread]);
  jset(ADVISOR_ACTIVE_KEY, thread.id);
  jremove(LEGACY_CHAT_KEY);
  return thread;
}

/** All advisor chat threads, newest activity first. */
export function getAdvisorThreads() {
  let threads = jget(ADVISOR_THREADS_KEY, null);
  if (threads === null) {
    migrateLegacyAdvisorChat();
    threads = jget(ADVISOR_THREADS_KEY, []);
  }
  return [...threads].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getActiveAdvisorThreadId() {
  const id = jget(ADVISOR_ACTIVE_KEY, null);
  const threads = getAdvisorThreads();
  if (id && threads.some((t) => t.id === id)) return id;
  if (threads.length) return threads[0].id;
  return null;
}

export function setActiveAdvisorThreadId(id) {
  jset(ADVISOR_ACTIVE_KEY, id);
}

export function getActiveAdvisorThread() {
  const id = getActiveAdvisorThreadId();
  if (!id) return null;
  return getAdvisorThreads().find((t) => t.id === id) || null;
}

/** Create an empty thread and make it active. */
export function createAdvisorThread() {
  const now = Date.now();
  const thread = {
    id: `thread-${now}-${Math.random().toString(36).slice(2, 5)}`,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  jset(ADVISOR_THREADS_KEY, [thread, ...getAdvisorThreads()]);
  setActiveAdvisorThreadId(thread.id);
  return thread;
}

function writeAdvisorThreads(threads) {
  jset(ADVISOR_THREADS_KEY, threads);
}

export function saveAdvisorThreadMessages(threadId, messages) {
  const now = Date.now();
  writeAdvisorThreads(
    getAdvisorThreads().map((t) => {
      if (t.id !== threadId) return t;
      const title =
        t.title === "New chat" && messages.length > 0
          ? autoThreadTitle(messages)
          : t.title;
      return { ...t, messages, title, updatedAt: now };
    })
  );
}

export function renameAdvisorThread(threadId, title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  writeAdvisorThreads(
    getAdvisorThreads().map((t) =>
      t.id === threadId ? { ...t, title: trimmed, updatedAt: Date.now() } : t
    )
  );
}

export function deleteAdvisorThread(threadId) {
  const remaining = getAdvisorThreads().filter((t) => t.id !== threadId);
  writeAdvisorThreads(remaining);
  if (getActiveAdvisorThreadId() === threadId) {
    setActiveAdvisorThreadId(remaining[0]?.id || null);
  }
}

/** @deprecated Legacy single-chat API — migrates on read. */
export const getAdvisorChat = () => getActiveAdvisorThread()?.messages || [];

export const getDisabledContextFiles = () => jget(CONTEXT_DISABLED_KEY, []);
export function setContextFileEnabled(fileName, enabled) {
  const disabled = new Set(getDisabledContextFiles());
  if (enabled) disabled.delete(fileName);
  else disabled.add(fileName);
  jset(CONTEXT_DISABLED_KEY, [...disabled]);
}

export const getContextOverrides = () => jget(CONTEXT_OVERRIDES_KEY, {});
export function setContextOverride(fileName, content) {
  const map = getContextOverrides();
  map[fileName] = content;
  jset(CONTEXT_OVERRIDES_KEY, map);
}
export function clearContextOverride(fileName) {
  const map = getContextOverrides();
  delete map[fileName];
  jset(CONTEXT_OVERRIDES_KEY, map);
}

export const getCustomContextEntries = () => jget(CONTEXT_CUSTOM_KEY, []);

/** Job-scoped custom context for any job, without switching the active job. */
export function getCustomContextEntriesForJob(jobId) {
  if (!jobId) return [];
  const list = storage.get(`job:${jobId}:${CONTEXT_CUSTOM_KEY}`, []);
  return Array.isArray(list) ? list : [];
}

export function hasCopiedSeedContext(jobId) {
  if (!jobId) return false;
  return storage.get(`job:${jobId}:${CONTEXT_SEED_COPIED_KEY}`, false) === true;
}

export function markSeedContextCopied(jobId) {
  if (!jobId) return;
  storage.set(`job:${jobId}:${CONTEXT_SEED_COPIED_KEY}`, true);
}

export function getContextOverridesForJob(jobId) {
  if (!jobId) return {};
  return storage.get(`job:${jobId}:${CONTEXT_OVERRIDES_KEY}`, {}) || {};
}

export function getDisabledContextFilesForJob(jobId) {
  if (!jobId) return [];
  const list = storage.get(`job:${jobId}:${CONTEXT_DISABLED_KEY}`, []);
  return Array.isArray(list) ? list : [];
}

export function setDisabledContextFilesForJob(jobId, ids) {
  if (!jobId) return;
  storage.set(`job:${jobId}:${CONTEXT_DISABLED_KEY}`, ids);
}

export function writeCustomContextEntriesForJob(jobId, list) {
  if (!jobId) return;
  storage.set(`job:${jobId}:${CONTEXT_CUSTOM_KEY}`, Array.isArray(list) ? list : []);
}

/** Job-scoped overrides, with a fallback to pre-multi-job leftover keys. */
export function getMergedContextOverridesForJob(jobId) {
  const legacy = storage.get("context:overrides", {});
  const scoped = getContextOverridesForJob(jobId);
  return {
    ...(legacy && typeof legacy === "object" ? legacy : {}),
    ...scoped,
  };
}

export function buildCustomContextEntry({ name, content, enabled = true, seedFile }) {
  const entry = {
    id: seedFile
      ? `ctx-seed-${String(seedFile).replace(/[^\w.-]+/g, "-")}`
      : `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || "").trim(),
    content: String(content || "").trim(),
    enabled: enabled !== false,
    createdAt: Date.now(),
  };
  if (seedFile) entry.seedFile = seedFile;
  return entry;
}

export function addCustomContextEntryForJob(jobId, fields) {
  if (!jobId) return null;
  const entry = buildCustomContextEntry(fields);
  const list = getCustomContextEntriesForJob(jobId);
  storage.set(`job:${jobId}:${CONTEXT_CUSTOM_KEY}`, [...list, entry]);
  return entry;
}

export function addCustomContextEntry({ name, content, seedFile }) {
  const entry = buildCustomContextEntry({ name, content, seedFile });
  jset(CONTEXT_CUSTOM_KEY, [...getCustomContextEntries(), entry]);
  return entry;
}
export function updateCustomContextEntry(id, patch) {
  const list = getCustomContextEntries().map((e) =>
    e.id === id ? { ...e, ...patch } : e
  );
  jset(CONTEXT_CUSTOM_KEY, list);
}
export function removeCustomContextEntry(id) {
  jset(
    CONTEXT_CUSTOM_KEY,
    getCustomContextEntries().filter((e) => e.id !== id)
  );
}

// ---- Interview recording flags (nav dots; blobs live in IndexedDB) ------------

const RECORDING_FLAGS_KEY = "recordings:hasByStage";

export function getRecordingFlags() {
  return jget(RECORDING_FLAGS_KEY, {});
}

export function setRecordingFlag(stageId, hasRecording) {
  const flags = getRecordingFlags();
  if (hasRecording) flags[stageId] = true;
  else delete flags[stageId];
  jset(RECORDING_FLAGS_KEY, flags);
}

export function hasRecording(stageId) {
  return !!getRecordingFlags()[stageId];
}

// ---- Interview stage progress (pipeline checklist) ----------------------------
//
// Per-job map of stageId → "pending" | "upcoming" | "in-progress" | "complete".
// Editable in Prep Docs. Defaults: first stage = in-progress, rest = upcoming.

const STAGE_PROGRESS_KEY = "stages:progress";

/** @typedef {"pending" | "upcoming" | "in-progress" | "complete"} StageProgressStatus */

export const STAGE_PROGRESS_STATUSES = [
  "pending",
  "upcoming",
  "in-progress",
  "complete",
];

export const STAGE_PROGRESS_LABELS = {
  pending: "Pending",
  upcoming: "Upcoming",
  "in-progress": "In progress",
  complete: "Complete",
};

/** Migrate legacy current/completed values written before the 4-status model. */
function normalizeProgressStatus(status) {
  if (status === "current") return "in-progress";
  if (status === "completed") return "complete";
  if (STAGE_PROGRESS_STATUSES.includes(status)) return status;
  return "upcoming";
}

function defaultStageProgressMap() {
  return {};
}

/**
 * Seed defaults for any known stage ids missing from the stored map.
 * On first init only, the first stage is marked in-progress. After that the
 * user's dropdown choices are left alone — completing every stage is valid.
 */
export function ensureStageProgressDefaults(stageIds = []) {
  const stored = jget(STAGE_PROGRESS_KEY, null);
  const isFirstInit = stored === null;
  const raw = { ...(stored || defaultStageProgressMap()) };
  const map = {};
  let changed = false;

  for (const [id, status] of Object.entries(raw)) {
    const next = normalizeProgressStatus(status);
    map[id] = next;
    if (next !== status) changed = true;
  }

  for (const id of stageIds) {
    if (!map[id]) {
      map[id] = "upcoming";
      changed = true;
    }
  }

  if (isFirstInit && stageIds[0] && !Object.values(map).some((s) => s === "in-progress")) {
    map[stageIds[0]] = "in-progress";
    changed = true;
  }

  if (changed || isFirstInit) {
    jset(STAGE_PROGRESS_KEY, map);
  }
  return map;
}

export function getStageProgressMap(stageIds = []) {
  if (stageIds.length) return ensureStageProgressDefaults(stageIds);
  const stored = jget(STAGE_PROGRESS_KEY, null);
  if (stored) {
    const map = {};
    let changed = false;
    for (const [id, status] of Object.entries(stored)) {
      const next = normalizeProgressStatus(status);
      map[id] = next;
      if (next !== status) changed = true;
    }
    if (changed) jset(STAGE_PROGRESS_KEY, map);
    return map;
  }
  const fresh = defaultStageProgressMap();
  jset(STAGE_PROGRESS_KEY, fresh);
  return { ...fresh };
}

export function getStageProgress(stageId, stageIds = []) {
  return getStageProgressMap(stageIds)[stageId] || "upcoming";
}

export function setStageProgress(stageId, status) {
  const map = getStageProgressMap();
  map[stageId] = normalizeProgressStatus(status);
  jset(STAGE_PROGRESS_KEY, map);
  return map;
}

/** Cycle pending → upcoming → in-progress → complete → pending. */
export function cycleStageProgress(stageId) {
  const order = STAGE_PROGRESS_STATUSES;
  const idx = order.indexOf(getStageProgress(stageId));
  const next = order[(idx + 1) % order.length];
  return setStageProgress(stageId, next);
}

/** Active stage id (status === in-progress), if any. */
export function getCurrentStageId(stageIds = []) {
  const map = getStageProgressMap(stageIds);
  const hit = Object.entries(map).find(([, status]) => status === "in-progress");
  return hit?.[0] || null;
}

// ---- Dismissed stage suggestions ------------------------------------------------

const DISMISSED_SUGGESTIONS_KEY = "stages:dismissedSuggestions";

export function getDismissedSuggestions() {
  return jget(DISMISSED_SUGGESTIONS_KEY, []);
}

export function dismissSuggestion(stageId) {
  const set = new Set(getDismissedSuggestions());
  set.add(stageId);
  jset(DISMISSED_SUGGESTIONS_KEY, [...set]);
  return [...set];
}

export function clearDismissedSuggestion(stageId) {
  jset(
    DISMISSED_SUGGESTIONS_KEY,
    getDismissedSuggestions().filter((id) => id !== stageId)
  );
}
