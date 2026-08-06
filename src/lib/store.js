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
 * here, replacing the build-time markdown. Stored as { markdown, savedAt }.
 * Returns null when the user hasn't edited/regenerated (so the original shows).
 */
export const getDocOverride = (stageId) => jget(overrideKey(stageId), null);
export const setDocOverride = (stageId, markdown) =>
  jset(overrideKey(stageId), { markdown, savedAt: Date.now() });
export const clearDocOverride = (stageId) => jremove(overrideKey(stageId));

// ---- Flashcard state ----------------------------------------------------------
//
// Per-card progress is stored as one map keyed by card id:
//   { [cardId]: { myAnswer, aiCoaching, confidence, lastReviewed } }
// User-generated cards (from "generate more") live in a separate array so the
// build-time seed deck stays clean.

const PROGRESS_KEY = "flashcards:progress";
const CUSTOM_KEY = "flashcards:custom";

export const getProgressMap = () => jget(PROGRESS_KEY, {});

/** Merge a partial progress object into a card's existing progress. */
export function setCardProgress(cardId, partial) {
  const map = getProgressMap();
  map[cardId] = { ...(map[cardId] || {}), ...partial, lastReviewed: Date.now() };
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
// Built-in /context/*.md files can be toggled off or content-overridden (saved
// locally — does not edit files on disk). Custom entries are advisor-only additions.

const CONTEXT_DISABLED_KEY = "context:disabled"; // string[] of builtin filenames
const CONTEXT_OVERRIDES_KEY = "context:overrides"; // { [filename]: markdown }
const CONTEXT_CUSTOM_KEY = "context:custom"; // { id, name, content, enabled }[]
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
export function addCustomContextEntry({ name, content }) {
  const list = getCustomContextEntries();
  const entry = {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    content: content.trim(),
    enabled: true,
    createdAt: Date.now(),
  };
  jset(CONTEXT_CUSTOM_KEY, [...list, entry]);
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
 * First stage becomes "in-progress" if nothing is marked in-progress yet.
 */
export function ensureStageProgressDefaults(stageIds = []) {
  const raw = { ...(jget(STAGE_PROGRESS_KEY, null) || defaultStageProgressMap()) };
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

  const hasInProgress = Object.values(map).some((s) => s === "in-progress");
  if (!hasInProgress && stageIds[0]) {
    map[stageIds[0]] = "in-progress";
    changed = true;
  }

  if (changed || jget(STAGE_PROGRESS_KEY, null) === null) {
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
