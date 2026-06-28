// IndexedDB setup for audio practice attempts + interview recordings.
//
// Audio blobs are too big for localStorage, so spoken-answer attempts (blob +
// transcript + score) and interview stage recordings live here. localStorage
// (store.js) keeps the small stuff.

import { openDB } from "idb";

const DB_NAME = "iprep-audio";
const DB_VERSION = 2;
const ATTEMPTS_STORE = "attempts";
const RECORDINGS_STORE = "interviewRecordings";

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(ATTEMPTS_STORE)) {
          const store = database.createObjectStore(ATTEMPTS_STORE, { keyPath: "id" });
          store.createIndex("byQuestion", "questionId");
          store.createIndex("byCreated", "createdAt");
        }
        if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
          const store = database.createObjectStore(RECORDINGS_STORE, { keyPath: "id" });
          store.createIndex("byStage", "stageId");
          store.createIndex("byCreated", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * An attempt:
 * {
 *   id, questionId, questionText, category, source ('flashcard'|'freeform'),
 *   referenceAnswer, keyPoints, transcript, audioBlob (Blob), audioType,
 *   durationMs, score (markdown coaching), createdAt
 * }
 */
export async function addAttempt(attempt) {
  const record = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    score: "",
    ...attempt,
  };
  await (await db()).put(ATTEMPTS_STORE, record);
  return record;
}

export async function updateAttempt(id, patch) {
  const d = await db();
  const existing = await d.get(ATTEMPTS_STORE, id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await d.put(ATTEMPTS_STORE, updated);
  return updated;
}

export async function deleteAttempt(id) {
  await (await db()).delete(ATTEMPTS_STORE, id);
}

/** All attempts, newest first. */
export async function getAllAttempts() {
  const all = await (await db()).getAll(ATTEMPTS_STORE);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Interview recording for a prep stage:
 * {
 *   id, stageId, fileName, audioBlob, audioType, durationMs,
 *   status ('uploaded'|'processing'|'done'|'error'),
 *   segments [{ speaker, startMs, endMs, text }],
 *   speakers [{ id, label }],
 *   summary (markdown), provider ('assemblyai'|'gemini'),
 *   createdAt, error?
 * }
 */
export async function getRecordingByStage(stageId) {
  const d = await db();
  const all = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  if (!all.length) return null;
  return all.sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function getAllRecordings() {
  const all = await (await db()).getAll(RECORDINGS_STORE);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRecording(recording) {
  const record = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    status: "uploaded",
    segments: [],
    speakers: [],
    summary: "",
    ...recording,
  };
  await (await db()).put(RECORDINGS_STORE, record);
  return record;
}

export async function updateRecording(id, patch) {
  const d = await db();
  const existing = await d.get(RECORDINGS_STORE, id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await d.put(RECORDINGS_STORE, updated);
  return updated;
}

export async function deleteRecording(id) {
  await (await db()).delete(RECORDINGS_STORE, id);
}

/** Replace any existing recording for a stage (one active per stage in v1). */
export async function replaceRecordingForStage(stageId, recording) {
  const d = await db();
  const existing = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  for (const rec of existing) {
    await d.delete(RECORDINGS_STORE, rec.id);
  }
  return saveRecording({ ...recording, stageId });
}
