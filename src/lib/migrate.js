// Versioned localStorage migrations, run once at boot (main.jsx) before render.
//
// v0 → v1: wrap all pre-multi-job flat state into a default job created from
// interview.config.js. Non-destructive: legacy keys are deleted only after the
// copied values are read back and verified (or already superseded by an
// existing job-scoped value); on any write failure the schema version is NOT
// stamped, so the (idempotent) copy retries next boot.
//
// Fresh installs (no legacy keys, no jobs collection) create NO job here —
// the onboarding wizard is responsible for creating the first job. main.jsx
// gets { migrated: false, jobId: null } back and skips jobId-dependent boot
// steps (e.g. the IndexedDB jobId backfill).

import * as storage from "./storage.js";
import { ensureDefaultJob, getActiveJobId, getJobs } from "./jobs.js";

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
    return { migrated: false, jobId: getActiveJobId() };
  }

  const legacyKeys = storage
    .listKeys()
    .filter((k) => LEGACY_PREFIXES.some((p) => k.startsWith(p)));

  // True fresh install: nothing to migrate and no jobs already created.
  // Stamp the schema and stop — do not conjure a phantom default job.
  if (legacyKeys.length === 0 && getJobs().length === 0) {
    storage.set("schemaVersion", CURRENT_SCHEMA);
    return { migrated: false, jobId: null };
  }

  const job = ensureDefaultJob();

  let allWritten = true;
  for (const key of legacyKeys) {
    const jobKey = `job:${job.id}:${key}`;
    // Stale-overwrite guard: if the job-scoped destination already has a
    // value, don't clobber it with a (possibly stale) legacy copy — this can
    // happen when a prior migration attempt partially succeeded and the app
    // wrote a newer value at the destination before the retry ran. The
    // existing destination value counts as verified, so the legacy key is
    // still safe to delete below.
    if (storage.get(jobKey, null) !== null) continue;

    const value = storage.get(key, null);
    const written = storage.set(jobKey, value);
    const verified =
      written && JSON.stringify(storage.get(jobKey, null)) === JSON.stringify(value);
    if (!verified) allWritten = false;
  }

  if (!allWritten) return { migrated: false, jobId: job.id };

  legacyKeys.forEach((key) => storage.remove(key));
  storage.set("schemaVersion", CURRENT_SCHEMA);
  return { migrated: true, jobId: job.id };
}

const DEMO_STATE_KEY = "demo:localStateVersion";

/**
 * Demo resync (run BEFORE runMigrations in main.jsx): when the demo config's
 * localStateVersion differs from the stored stamp, wipes ALL iprep: keys so
 * the next runMigrations() starts from a clean slate and main.jsx can reseed
 * a demo job from the CURRENT demo config. Returns whether a wipe happened.
 * No-op (returns false) when version is null/undefined (non-demo builds) or
 * already matches the stored stamp.
 */
export function applyDemoResync(version) {
  if (version == null) return false;
  if (storage.get(DEMO_STATE_KEY, null) === version) return false;
  storage.listKeys("").forEach((key) => storage.remove(key));
  return true;
}
