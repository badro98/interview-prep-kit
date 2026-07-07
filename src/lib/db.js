// IndexedDB setup for audio practice attempts + interview recordings.
//
// Audio blobs are too big for localStorage, so spoken-answer attempts (blob +
// transcript + score) and interview stage recordings live here. localStorage
// (store.js) keeps the small stuff.

import { openDB } from "idb";
import { getActiveJobId } from "./jobs.js";

const DB_NAME = "iprep-audio";
const DB_VERSION = 3;
const ATTEMPTS_STORE = "attempts";
const RECORDINGS_STORE = "interviewRecordings";

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, newVersion, transaction) {
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
        for (const name of [ATTEMPTS_STORE, RECORDINGS_STORE]) {
          const store = transaction.objectStore(name);
          if (!store.indexNames.contains("byJob")) store.createIndex("byJob", "jobId");
        }
      },
      blocking() {
        // An upgrade in another tab is waiting on this connection — release it
        // so that tab can proceed. The next db() call here reopens fresh.
        dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
      blocked() {
        console.warn("iprep: waiting for another tab to close its database connection");
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
    jobId: getActiveJobId(),
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

/** All attempts for the ACTIVE job, newest first. */
export async function getAllAttempts() {
  const jobId = getActiveJobId();
  const all = await (await db()).getAll(ATTEMPTS_STORE);
  return all
    .filter((a) => a.jobId === jobId)
    .sort((a, b) => b.createdAt - a.createdAt);
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
  const jobId = getActiveJobId();
  const d = await db();
  const all = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  const mine = all.filter((r) => r.jobId === jobId);
  if (!mine.length) return null;
  return mine.sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function getAllRecordings() {
  const jobId = getActiveJobId();
  const all = await (await db()).getAll(RECORDINGS_STORE);
  return all
    .filter((r) => r.jobId === jobId)
    .sort((a, b) => b.createdAt - a.createdAt);
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
    jobId: getActiveJobId(),
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
  const jobId = getActiveJobId();
  const d = await db();
  const existing = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  for (const rec of existing) {
    if (rec.jobId === jobId) await d.delete(RECORDINGS_STORE, rec.id);
  }
  return saveRecording({ ...recording, stageId });
}

/** Stamp jobId onto legacy records that predate job scoping. Returns count updated. */
export async function backfillJobIds(jobId) {
  if (!jobId) return 0;
  const d = await db();
  let updated = 0;
  for (const storeName of [ATTEMPTS_STORE, RECORDINGS_STORE]) {
    const all = await d.getAll(storeName);
    for (const record of all) {
      if (record.jobId == null) {
        await d.put(storeName, { ...record, jobId });
        updated++;
      }
    }
  }
  return updated;
}
