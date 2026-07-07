// Versioned localStorage migrations, run once at boot (main.jsx) before render.
//
// v0 → v1: wrap all pre-multi-job flat state into a default job created from
// interview.config.js. Non-destructive: legacy keys are deleted only after the
// copied values are read back and verified; on any write failure the schema
// version is NOT stamped, so the (idempotent) copy retries next boot.

import * as storage from "./storage.js";
import { ensureDefaultJob, getActiveJobId } from "./jobs.js";

export const CURRENT_SCHEMA = 1;

// Flat key prefixes that belong to a job (everything store.js job-scopes).
const LEGACY_PREFIXES = [
  "prepdoc:override:",
  "flashcards:",
  "context:",
  "advisor:",
  "recordings:",
];

export function runMigrations() {
  const version = storage.get("schemaVersion", 0);
  if (version >= CURRENT_SCHEMA) {
    ensureDefaultJob();
    return { migrated: false, jobId: getActiveJobId() };
  }

  const job = ensureDefaultJob();
  const legacyKeys = storage
    .listKeys()
    .filter((k) => LEGACY_PREFIXES.some((p) => k.startsWith(p)));

  let allWritten = true;
  for (const key of legacyKeys) {
    const value = storage.get(key, null);
    const written = storage.set(`job:${job.id}:${key}`, value);
    const verified =
      written &&
      JSON.stringify(storage.get(`job:${job.id}:${key}`, null)) === JSON.stringify(value);
    if (!verified) allWritten = false;
  }

  if (!allWritten) return { migrated: false, jobId: job.id };

  legacyKeys.forEach((key) => storage.remove(key));
  storage.set("schemaVersion", CURRENT_SCHEMA);
  return { migrated: true, jobId: job.id };
}
