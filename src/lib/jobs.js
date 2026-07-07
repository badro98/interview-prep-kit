// Jobs collection + active-job selection. Each job owns its stages and advisor
// starters (copied from interview.config.js defaults at creation). All per-job
// feature state in store.js/db.js is namespaced by the active job's id.

import { get, set, remove, listKeys } from "./storage.js";
import { deleteJobRecords } from "./db.js";
import { APP, STAGES, ADVISOR_STARTERS } from "../../interview.config.js";

const JOBS_KEY = "jobs";
const ACTIVE_KEY = "activeJobId";

function newJobId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export const getJobs = () => get(JOBS_KEY, []);

export const getJob = (id) => getJobs().find((j) => j.id === id) || null;

export function createJob({ role, company, stages, advisorStarters } = {}) {
  const job = {
    id: newJobId(),
    role: role || APP.role,
    company: company || APP.company,
    status: "active",
    createdAt: Date.now(),
    stages: (stages || STAGES).map((s) => ({ ...s })),
    advisorStarters: [...(advisorStarters || ADVISOR_STARTERS)],
  };
  set(JOBS_KEY, [...getJobs(), job]);
  return job;
}

export function updateJob(id, patch) {
  const jobs = getJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  const updated = { ...jobs[idx], ...patch, id };
  jobs[idx] = updated;
  set(JOBS_KEY, jobs);
  return updated;
}

export function deleteJob(id) {
  set(JOBS_KEY, getJobs().filter((j) => j.id !== id));
}

export function getActiveJobId() {
  const jobs = getJobs();
  const id = get(ACTIVE_KEY, null);
  if (id && jobs.some((j) => j.id === id)) return id;
  return jobs[0]?.id || null;
}

export const setActiveJobId = (id) => set(ACTIVE_KEY, id);

export const getActiveJob = () => getJob(getActiveJobId());

/** Creates a job from repo-config defaults when none exist (pre-onboarding safety net). */
export function ensureDefaultJob() {
  const existing = getActiveJob();
  if (existing) return existing;
  const job = createJob({});
  setActiveJobId(job.id);
  return job;
}

/** A job is seed-backed iff any of its stages has a bundled seed `file` (repo generated/ + context/ data). */
export const isSeedBacked = (job) => !!job?.stages?.some((s) => s.file);

const jobNamespace = (jobId) => `job:${jobId}:`;

/**
 * Deletes a job, every localStorage key namespaced under it, and every IDB
 * row (attempts + recordings) belonging to it. If the deleted job was active,
 * activeJobId is re-pointed to the first remaining job synchronously — before
 * the async IDB purge — so a re-render mid-await never queries a dangling job
 * id. Safe even when called on the last remaining job.
 */
export async function deleteJobWithData(jobId) {
  const wasActive = getActiveJobId() === jobId;
  const jobKeys = listKeys(jobNamespace(jobId));
  for (const key of jobKeys) remove(key);

  deleteJob(jobId);

  if (wasActive) {
    const remaining = getJobs();
    if (remaining.length) setActiveJobId(remaining[0].id);
    else remove(ACTIVE_KEY);
  }

  const { attempts, recordings } = await deleteJobRecords(jobId);
  return { removedKeys: jobKeys.length, attempts, recordings };
}

/**
 * Exports a job as a portable JSON payload: the job record plus every bare
 * (legacy-key) localStorage entry namespaced under it. Audio blobs stored in
 * IndexedDB (attempts/recordings) are NOT exported — they're too large for a
 * JSON file and are considered ephemeral practice data.
 */
export function exportJob(jobId) {
  const job = getJob(jobId);
  const prefix = jobNamespace(jobId);
  const state = {};
  for (const key of listKeys(prefix)) {
    state[key.slice(prefix.length)] = get(key);
  }
  return { version: 1, kind: "iprep-job", job, state };
}

/**
 * Imports a job export payload under a freshly generated id (the incoming id
 * is never trusted/reused). Appends the job to the collection and writes its
 * state under the new id's namespace. Does not change the active job. Throws
 * on any malformed payload.
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidStage(stage) {
  return (
    isPlainObject(stage) &&
    typeof stage.id === "string" &&
    typeof stage.title === "string" &&
    (stage.subtitle === undefined || typeof stage.subtitle === "string") &&
    (stage.regenTask === undefined || typeof stage.regenTask === "string") &&
    (stage.file === undefined || typeof stage.file === "string")
  );
}

export function importJob(data) {
  const valid =
    data &&
    data.kind === "iprep-job" &&
    data.version === 1 &&
    data.job &&
    typeof data.job.role === "string" &&
    typeof data.job.company === "string" &&
    (data.job.stages === undefined ||
      (Array.isArray(data.job.stages) && data.job.stages.every(isValidStage))) &&
    (data.job.advisorStarters === undefined ||
      (Array.isArray(data.job.advisorStarters) &&
        data.job.advisorStarters.every((s) => typeof s === "string"))) &&
    data.state &&
    typeof data.state === "object" &&
    !Array.isArray(data.state);
  if (!valid) throw new Error("Invalid job export file");

  const job = createJob({
    role: data.job.role,
    company: data.job.company,
    stages: data.job.stages,
    advisorStarters: data.job.advisorStarters,
  });

  const prefix = jobNamespace(job.id);
  for (const [legacyKey, value] of Object.entries(data.state)) {
    set(prefix + legacyKey, value);
  }

  return job;
}
