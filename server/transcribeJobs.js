// In-memory transcription jobs (local dev — one user, one machine).

const jobs = new Map();
const TTL_MS = 2 * 60 * 60 * 1000;

function newId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createJob() {
  prune();
  const id = newId();
  jobs.set(id, {
    id,
    status: "queued",
    phase: "Uploading",
    progress: 0,
    result: null,
    partialResult: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return id;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function patchJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  const next = { ...job, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  return next;
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "done" || job.status === "error") return job;
  return patchJob(id, {
    status: "cancelled",
    phase: "Cancelled",
    error: "Cancelled by user",
    partialResult: null,
  });
}

export function publicJobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    partialResult:
      job.status === "running" && job.partialResult ? job.partialResult : undefined,
    result: job.status === "done" ? job.result : undefined,
    error: job.status === "error" ? job.error : undefined,
  };
}
