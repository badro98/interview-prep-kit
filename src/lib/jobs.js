// Jobs collection + active-job selection. Each job owns its stages and advisor
// starters (copied from interview.config.js defaults at creation). All per-job
// feature state in store.js/db.js is namespaced by the active job's id.

import { get, set } from "./storage.js";
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
