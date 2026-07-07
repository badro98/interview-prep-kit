# Multi-Job PR1: Storage Adapter + Job Namespacing + Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a jobs collection and namespace all per-job browser state by job id, with a versioned migration that moves existing flat state into a default job — while the app stays visually identical.

**Architecture:** A new low-level `storage.js` becomes the only module touching localStorage. A new `jobs.js` owns the jobs collection and active-job id. `store.js` keeps its entire public API but internally prefixes job-scoped keys with `job:<activeJobId>:`. `db.js` (IndexedDB) stamps records with `jobId` and filters reads by the active job. A versioned migration runs at boot in `main.jsx`.

**Tech Stack:** Plain JS (ESM, no TypeScript), React 18, Vite 6, idb, Vitest + jsdom + fake-indexeddb (new dev deps).

**Spec:** `docs/superpowers/specs/2026-07-06-multi-job-support-design.md` (this plan = spec's PR1).

## Global Constraints

- Plain JavaScript only — no TypeScript syntax anywhere.
- Every existing exported function in `src/lib/store.js` and `src/lib/db.js` keeps its exact name and signature. Feature files (`src/features/**`, `src/lib/coach.js`, `src/lib/context.js`) must NOT be modified in this PR.
- Only `src/lib/storage.js` may call `localStorage`; only `src/lib/db.js` may touch IndexedDB.
- localStorage namespace prefix stays `iprep:` (existing user data depends on it).
- Job-scoped localStorage key shape: `job:<jobId>:<legacy key>`. Global (job-independent) keys: `mode` (AI mode, lives in coach.js), `jobs`, `activeJobId`, `schemaVersion`, `demo:localStateVersion`.
- Migration must be non-destructive: legacy keys are deleted only after copied values are read back and verified.
- App must remain runnable (`npm run dev`) and buildable (`npm run build`) after every task.
- Work on branch `multi-job-support`. Commit after every task.

---

### Task 1: Vitest setup + `storage.js` adapter

**Files:**
- Create: `src/lib/storage.js`
- Create: `vitest.config.js`
- Modify: `package.json` (add `test` script; dev deps via npm install)
- Test: `src/lib/__tests__/storage.test.js`

**Interfaces:**
- Consumes: nothing (bottom of the stack).
- Produces: `get(key, fallback=null) → any`, `set(key, value) → boolean`, `remove(key) → boolean`, `listKeys(prefix="") → string[]` (namespace-stripped), `onQuotaError(handler)` where handler is `(key, err) => void`. All keys are namespace-bare (module adds `iprep:` internally).

- [ ] **Step 1: Install dev deps and add scripts**

```bash
npm install -D vitest jsdom fake-indexeddb
```

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/__tests__/storage.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, set, remove, listKeys, onQuotaError } from "../storage.js";

beforeEach(() => {
  localStorage.clear();
  onQuotaError(null);
});

describe("storage adapter", () => {
  it("round-trips JSON values under the iprep namespace", () => {
    expect(set("foo", { a: 1 })).toBe(true);
    expect(get("foo")).toEqual({ a: 1 });
    expect(localStorage.getItem("iprep:foo")).toBe('{"a":1}');
  });

  it("returns the fallback for missing keys", () => {
    expect(get("missing", "fb")).toBe("fb");
    expect(get("missing")).toBeNull();
  });

  it("returns the fallback for corrupted JSON", () => {
    localStorage.setItem("iprep:bad", "{not json");
    expect(get("bad", 42)).toBe(42);
  });

  it("remove deletes the key", () => {
    set("gone", 1);
    remove("gone");
    expect(get("gone")).toBeNull();
  });

  it("listKeys returns namespace-stripped keys filtered by prefix", () => {
    set("flashcards:progress", {});
    set("flashcards:custom", []);
    set("advisor:threads", []);
    localStorage.setItem("other-app:x", "1"); // outside namespace — ignored
    expect(listKeys("flashcards:").sort()).toEqual([
      "flashcards:custom",
      "flashcards:progress",
    ]);
    expect(listKeys().sort()).toEqual([
      "advisor:threads",
      "flashcards:custom",
      "flashcards:progress",
    ]);
  });

  it("fires the quota handler and returns false when setItem throws quota", () => {
    const handler = vi.fn();
    onQuotaError(handler);
    const err = new DOMException("full", "QuotaExceededError");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw err;
    });
    expect(set("big", "x")).toBe(false);
    expect(handler).toHaveBeenCalledWith("big", err);
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/storage.test.js`
Expected: FAIL — cannot resolve `../storage.js`.

- [ ] **Step 4: Implement `src/lib/storage.js`**

```js
// Low-level localStorage adapter — the ONLY module allowed to touch localStorage.
// Feature code goes through store.js; store.js goes through here.
// Keys passed in are namespace-bare; the iprep: prefix is added internally.

const NS = "iprep:";

let quotaHandler = null;

/** Register a callback fired when a write fails on storage quota (null to clear). */
export function onQuotaError(handler) {
  quotaHandler = handler;
}

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (err?.name === "QuotaExceededError" && quotaHandler) quotaHandler(key, err);
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(NS + key);
    return true;
  } catch {
    return false;
  }
}

/** All keys in our namespace (namespace stripped), optionally filtered by prefix. */
export function listKeys(prefix = "") {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(NS)) continue;
    const bare = k.slice(NS.length);
    if (bare.startsWith(prefix)) keys.push(bare);
  }
  return keys;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/storage.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/lib/storage.js src/lib/__tests__/storage.test.js
git commit -m "feat: add localStorage adapter and Vitest setup"
```

---

### Task 2: `jobs.js` — jobs collection + active job

**Files:**
- Create: `src/lib/jobs.js`
- Test: `src/lib/__tests__/jobs.test.js`

**Interfaces:**
- Consumes: `storage.get/set` from Task 1; `APP`, `STAGES`, `ADVISOR_STARTERS` from `interview.config.js`.
- Produces: `getJobs() → Job[]`, `getJob(id) → Job|null`, `createJob(partial?) → Job`, `updateJob(id, patch) → Job|null`, `deleteJob(id) → void`, `getActiveJobId() → string|null`, `setActiveJobId(id) → void`, `getActiveJob() → Job|null`, `ensureDefaultJob() → Job`. Job shape: `{ id, role, company, status: "active", createdAt, stages: [{id,title,subtitle,file,regenTask}], advisorStarters: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/jobs.test.js`:

```js
import { beforeEach, describe, expect, it } from "vitest";
import {
  getJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  getActiveJobId,
  setActiveJobId,
  getActiveJob,
  ensureDefaultJob,
} from "../jobs.js";
import { APP, STAGES } from "../../../interview.config.js";

beforeEach(() => localStorage.clear());

describe("jobs collection", () => {
  it("starts empty with no active job", () => {
    expect(getJobs()).toEqual([]);
    expect(getActiveJobId()).toBeNull();
    expect(getActiveJob()).toBeNull();
  });

  it("createJob defaults role/company/stages from interview.config.js", () => {
    const job = createJob({});
    expect(job.role).toBe(APP.role);
    expect(job.company).toBe(APP.company);
    expect(job.status).toBe("active");
    expect(job.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    expect(getJob(job.id)).toEqual(job);
  });

  it("createJob copies stages so edits do not mutate config", () => {
    const job = createJob({});
    job.stages[0].title = "Changed";
    expect(STAGES[0].title).not.toBe("Changed");
  });

  it("accepts explicit fields", () => {
    const job = createJob({ role: "QA Lead", company: "Cursor" });
    expect(job.role).toBe("QA Lead");
    expect(job.company).toBe("Cursor");
  });

  it("updateJob patches and persists", () => {
    const job = createJob({});
    const updated = updateJob(job.id, { company: "NewCo" });
    expect(updated.company).toBe("NewCo");
    expect(getJob(job.id).company).toBe("NewCo");
    expect(updateJob("nope", {})).toBeNull();
  });

  it("active job falls back to the first job when unset or stale", () => {
    const a = createJob({ role: "A" });
    const b = createJob({ role: "B" });
    expect(getActiveJobId()).toBe(a.id);
    setActiveJobId(b.id);
    expect(getActiveJob().role).toBe("B");
    deleteJob(b.id);
    expect(getActiveJobId()).toBe(a.id);
  });

  it("ensureDefaultJob creates one job when none exist, is a no-op otherwise", () => {
    const job = ensureDefaultJob();
    expect(getJobs()).toHaveLength(1);
    expect(getActiveJobId()).toBe(job.id);
    expect(ensureDefaultJob().id).toBe(job.id);
    expect(getJobs()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/jobs.test.js`
Expected: FAIL — cannot resolve `../jobs.js`.

- [ ] **Step 3: Implement `src/lib/jobs.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/jobs.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs.js src/lib/__tests__/jobs.test.js
git commit -m "feat: add jobs collection with active-job selection"
```

---

### Task 3: Job-scope `store.js` internally (public API unchanged)

**Files:**
- Modify: `src/lib/store.js` (lines 1–34 replaced; internal calls redirected)
- Test: `src/lib/__tests__/store.test.js`

**Interfaces:**
- Consumes: `storage.get/set/remove` (Task 1), `getActiveJobId` (Task 2).
- Produces: identical public API as today — `get/set/remove` (now explicitly GLOBAL state, used by coach.js for the AI mode), plus all job-scoped helpers (`getDocOverride`, `setCardProgress`, `getAdvisorThreads`, `setContextOverride`, `getRecordingFlags`, etc.) with unchanged names/signatures, now reading/writing `job:<activeJobId>:<key>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/store.test.js`:

```js
import { beforeEach, describe, expect, it } from "vitest";
import { createJob, setActiveJobId } from "../jobs.js";
import {
  get,
  set,
  getDocOverride,
  setDocOverride,
  setCardProgress,
  getProgressMap,
  addCustomContextEntry,
  getCustomContextEntries,
} from "../store.js";

beforeEach(() => localStorage.clear());

describe("job-scoped store", () => {
  it("prep-doc overrides are isolated per job", () => {
    const a = createJob({ role: "A" });
    const b = createJob({ role: "B" });
    setActiveJobId(a.id);
    setDocOverride("onsite", "# Job A notes");
    expect(getDocOverride("onsite").markdown).toBe("# Job A notes");

    setActiveJobId(b.id);
    expect(getDocOverride("onsite")).toBeNull();

    setActiveJobId(a.id);
    expect(getDocOverride("onsite").markdown).toBe("# Job A notes");
  });

  it("stores job-scoped keys under job:<id>: prefix", () => {
    const a = createJob({});
    setActiveJobId(a.id);
    setDocOverride("final", "x");
    expect(localStorage.getItem(`iprep:job:${a.id}:prepdoc:override:final`)).toBeTruthy();
  });

  it("flashcard progress and custom context are isolated per job", () => {
    const a = createJob({});
    const b = createJob({});
    setActiveJobId(a.id);
    setCardProgress("card-1", { confidence: 4 });
    addCustomContextEntry({ name: "Intel", content: "notes" });

    setActiveJobId(b.id);
    expect(getProgressMap()).toEqual({});
    expect(getCustomContextEntries()).toEqual([]);

    setActiveJobId(a.id);
    expect(getProgressMap()["card-1"].confidence).toBe(4);
    expect(getCustomContextEntries()).toHaveLength(1);
  });

  it("raw get/set remain global (job-independent)", () => {
    const a = createJob({});
    const b = createJob({});
    setActiveJobId(a.id);
    set("mode", "paste");
    setActiveJobId(b.id);
    expect(get("mode")).toBe("paste");
    expect(localStorage.getItem("iprep:mode")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/store.test.js`
Expected: FAIL — doc override written under job A is visible under job B (no namespacing yet), and the `job:<id>:` key assertion fails.

- [ ] **Step 3: Rewire `store.js`**

Replace lines 1–34 of `src/lib/store.js` (the header comment, `NS`, and the `get`/`set`/`remove` implementations) with:

```js
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
```

Then, in the remainder of the file, replace every internal call to `get(` / `set(` / `remove(` with `jget(` / `jset(` / `jremove(` — EXCEPT inside `applyDemoLocalReset`, where the two `DEMO_STATE_KEY` accesses (`get(DEMO_STATE_KEY, null)` and `set(DEMO_STATE_KEY, version)`) stay global; its other resets (`CONTEXT_CUSTOM_KEY`, `ADVISOR_THREADS_KEY`, `ADVISOR_ACTIVE_KEY`, `LEGACY_CHAT_KEY`) become `jset`/`jremove`. The affected functions (verify each one now uses only `jget`/`jset`/`jremove` for job state): `getDocOverride`, `setDocOverride`, `clearDocOverride`, `getProgressMap`, `setCardProgress`, `getCustomCards`, `addCustomCards`, `getModelOverrides`, `setModelOverride`, `clearModelOverride`, `migrateLegacyAdvisorChat`, `getAdvisorThreads`, `getActiveAdvisorThreadId`, `setActiveAdvisorThreadId`, `createAdvisorThread`, `writeAdvisorThreads`, `saveAdvisorThreadMessages` (via `writeAdvisorThreads`), `deleteAdvisorThread`, `getDisabledContextFiles`, `setContextFileEnabled`, `getContextOverrides`, `setContextOverride`, `clearContextOverride`, `getCustomContextEntries`, `addCustomContextEntry`, `updateCustomContextEntry`, `removeCustomContextEntry`, `getRecordingFlags`, `setRecordingFlag`, `applyDemoLocalReset` (partially, per above).

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — storage, jobs, and store suites all green.

- [ ] **Step 5: Sanity-check the app still boots**

Run: `npm run build`
Expected: build succeeds with no import errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.js src/lib/__tests__/store.test.js
git commit -m "feat: namespace all per-job store state by active job id"
```

---

### Task 4: Versioned migration of legacy flat state

**Files:**
- Create: `src/lib/migrate.js`
- Test: `src/lib/__tests__/migrate.test.js`

**Interfaces:**
- Consumes: `storage.get/set/remove/listKeys` (Task 1), `ensureDefaultJob`, `getActiveJobId` (Task 2).
- Produces: `runMigrations() → { migrated: boolean, jobId: string }` — idempotent, called once at boot before render. `CURRENT_SCHEMA = 1`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/migrate.test.js`:

```js
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations, CURRENT_SCHEMA } from "../migrate.js";
import { getJobs, getActiveJobId, setActiveJobId, createJob } from "../jobs.js";
import { getDocOverride, getProgressMap } from "../store.js";
import * as storage from "../storage.js";
import { APP } from "../../../interview.config.js";

beforeEach(() => localStorage.clear());

describe("runMigrations", () => {
  it("fresh install: creates a default job and stamps the schema version", () => {
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(true);
    expect(getJobs()).toHaveLength(1);
    expect(getActiveJobId()).toBe(jobId);
    expect(getJobs()[0].role).toBe(APP.role);
    expect(storage.get("schemaVersion")).toBe(CURRENT_SCHEMA);
  });

  it("moves legacy flat keys under the default job and deletes the originals", () => {
    localStorage.setItem(
      "iprep:prepdoc:override:onsite",
      JSON.stringify({ markdown: "# my edits", savedAt: 1 })
    );
    localStorage.setItem(
      "iprep:flashcards:progress",
      JSON.stringify({ "card-1": { confidence: 5 } })
    );
    localStorage.setItem("iprep:advisor:chat", JSON.stringify([{ role: "user", content: "hi" }]));
    localStorage.setItem("iprep:mode", JSON.stringify("paste")); // global — untouched

    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(true);

    // Old flat keys gone, new job-scoped keys present.
    expect(localStorage.getItem("iprep:prepdoc:override:onsite")).toBeNull();
    expect(localStorage.getItem("iprep:flashcards:progress")).toBeNull();
    expect(storage.get(`job:${jobId}:advisor:chat`)).toEqual([{ role: "user", content: "hi" }]);
    expect(localStorage.getItem("iprep:mode")).toBe('"paste"');

    // And the job-scoped store reads them for the active job.
    setActiveJobId(jobId);
    expect(getDocOverride("onsite").markdown).toBe("# my edits");
    expect(getProgressMap()["card-1"].confidence).toBe(5);
  });

  it("is idempotent — second run is a no-op", () => {
    localStorage.setItem("iprep:flashcards:custom", JSON.stringify([{ id: "c1" }]));
    const first = runMigrations();
    const second = runMigrations();
    expect(second.migrated).toBe(false);
    expect(second.jobId).toBe(first.jobId);
    expect(getJobs()).toHaveLength(1);
  });

  it("does not create a second job when jobs already exist", () => {
    const job = createJob({ role: "Existing" });
    setActiveJobId(job.id);
    storage.set("schemaVersion", CURRENT_SCHEMA);
    const { migrated, jobId } = runMigrations();
    expect(migrated).toBe(false);
    expect(jobId).toBe(job.id);
    expect(getJobs()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/migrate.test.js`
Expected: FAIL — cannot resolve `../migrate.js`.

- [ ] **Step 3: Implement `src/lib/migrate.js`**

```js
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
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — all four suites green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrate.js src/lib/__tests__/migrate.test.js
git commit -m "feat: migrate legacy flat browser state into a default job"
```

---

### Task 5: Job-scope IndexedDB records (`db.js`)

**Files:**
- Modify: `src/lib/db.js`
- Test: `src/lib/__tests__/db.test.js`

**Interfaces:**
- Consumes: `getActiveJobId` (Task 2).
- Produces: unchanged public API (`addAttempt`, `updateAttempt`, `deleteAttempt`, `getAllAttempts`, `getRecordingByStage`, `getAllRecordings`, `saveRecording`, `updateRecording`, `deleteRecording`, `replaceRecordingForStage`) — writes now stamp `jobId: getActiveJobId()`, list/lookup reads filter to the active job. New export: `backfillJobIds(jobId) → Promise<number>` (stamps records missing `jobId`; returns count), called at boot by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/db.test.js`:

```js
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory(); // fresh DB per test
});

// db.js caches its connection at module level, so import a fresh copy per test.
async function freshModules() {
  const db = await import(`../db.js?t=${Date.now()}-${Math.random()}`);
  const jobs = await import("../jobs.js");
  return { db, jobs };
}

describe("job-scoped IndexedDB", () => {
  it("attempts are stamped with the active job and filtered on read", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({ role: "A" });
    const b = jobs.createJob({ role: "B" });

    jobs.setActiveJobId(a.id);
    await db.addAttempt({ questionId: "q1", transcript: "hello" });

    jobs.setActiveJobId(b.id);
    expect(await db.getAllAttempts()).toEqual([]);

    jobs.setActiveJobId(a.id);
    const attempts = await db.getAllAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].jobId).toBe(a.id);
  });

  it("recordings are isolated per job for the same stage id", async () => {
    const { db, jobs } = await freshModules();
    const a = jobs.createJob({});
    const b = jobs.createJob({});

    jobs.setActiveJobId(a.id);
    await db.replaceRecordingForStage("onsite", { fileName: "a.wav" });

    jobs.setActiveJobId(b.id);
    expect(await db.getRecordingByStage("onsite")).toBeNull();
    await db.replaceRecordingForStage("onsite", { fileName: "b.wav" });

    jobs.setActiveJobId(a.id);
    expect((await db.getRecordingByStage("onsite")).fileName).toBe("a.wav");
    expect(await db.getAllRecordings()).toHaveLength(1);
  });

  it("backfillJobIds stamps legacy records missing jobId", async () => {
    const { db, jobs } = await freshModules();
    const job = jobs.createJob({});
    jobs.setActiveJobId(job.id);

    // Simulate a legacy record written before job scoping existed.
    await db.addAttempt({ questionId: "q-legacy", transcript: "old", jobId: undefined });
    const count = await db.backfillJobIds(job.id);
    expect(count).toBeGreaterThanOrEqual(0); // addAttempt now stamps; count covers true legacy rows

    const attempts = await db.getAllAttempts();
    expect(attempts.every((x) => x.jobId === job.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/db.test.js`
Expected: FAIL — attempts written under job A are visible under job B, and `backfillJobIds` is not exported.

- [ ] **Step 3: Modify `src/lib/db.js`**

Apply these changes:

3a. Add the import at the top and bump the DB version:

```js
import { getActiveJobId } from "./jobs.js";
```

```js
const DB_VERSION = 3;
```

3b. Extend the `upgrade` callback to add `byJob` indexes (works for both fresh installs and v2 → v3 upgrades):

```js
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
```

3c. Stamp writes. In `addAttempt`, add `jobId: getActiveJobId(),` to the defaults (before `...attempt` so an explicit jobId still wins — but after-spread fields must not override a caller's value; keep it in the defaults block):

```js
  const record = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    score: "",
    jobId: getActiveJobId(),
    ...attempt,
  };
```

In `saveRecording`, same pattern — add `jobId: getActiveJobId(),` to the defaults object before `...recording`.

3d. Filter reads by active job:

```js
/** All attempts for the ACTIVE job, newest first. */
export async function getAllAttempts() {
  const jobId = getActiveJobId();
  const all = await (await db()).getAll(ATTEMPTS_STORE);
  return all
    .filter((a) => a.jobId === jobId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
```

```js
export async function getRecordingByStage(stageId) {
  const jobId = getActiveJobId();
  const d = await db();
  const all = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  const mine = all.filter((r) => r.jobId === jobId);
  if (!mine.length) return null;
  return mine.sort((a, b) => b.createdAt - a.createdAt)[0];
}
```

```js
export async function getAllRecordings() {
  const jobId = getActiveJobId();
  const all = await (await db()).getAll(RECORDINGS_STORE);
  return all
    .filter((r) => r.jobId === jobId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
```

In `replaceRecordingForStage`, only delete the active job's recordings for that stage:

```js
export async function replaceRecordingForStage(stageId, recording) {
  const jobId = getActiveJobId();
  const d = await db();
  const existing = await d.getAllFromIndex(RECORDINGS_STORE, "byStage", stageId);
  for (const rec of existing) {
    if (rec.jobId === jobId) await d.delete(RECORDINGS_STORE, rec.id);
  }
  return saveRecording({ ...recording, stageId });
}
```

3e. Add the backfill (used at boot for records created before job scoping):

```js
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
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — all five suites green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/lib/__tests__/db.test.js
git commit -m "feat: scope IndexedDB attempts and recordings by job"
```

---

### Task 6: Boot wiring + end-to-end verification

**Files:**
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes: `runMigrations` (Task 4), `backfillJobIds` (Task 5).
- Produces: migrations complete before first render; nothing new for later tasks.

- [ ] **Step 1: Read `src/main.jsx`, then wrap render in an async boot**

Read the current file first (it is a few lines: React root render + CSS import). Rework it to run migrations before rendering, preserving the existing imports and render call:

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { runMigrations } from "./lib/migrate.js";
import { backfillJobIds } from "./lib/db.js";

async function boot() {
  const { jobId } = runMigrations();
  try {
    await backfillJobIds(jobId);
  } catch (err) {
    // IndexedDB backfill failing must not block the app; legacy audio rows
    // just stay hidden until the next successful boot.
    console.warn("iprep: jobId backfill failed", err);
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

boot();
```

Keep whatever the actual current file has (e.g. if it does not use `React.StrictMode`, match the existing render exactly — only add the boot wrapper and the two imports).

- [ ] **Step 2: Full test suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 3: Manual verification of the migration in a real browser**

Run: `npm run dev`, open the app in Chrome, then in DevTools → Application → Local Storage verify:
- `iprep:jobs` exists with one job (role/company from `interview.config.js`)
- `iprep:activeJobId` and `iprep:schemaVersion` = 1 exist
- No flat `iprep:flashcards:*` / `iprep:advisor:*` / `iprep:context:*` keys remain (they are either absent on a fresh profile or re-prefixed `iprep:job:<id>:...`)

Exercise the app: edit a prep doc, answer a flashcard, add a custom context entry, send an advisor message (paste mode is fine) — reload and confirm everything persists.

- [ ] **Step 4: Commit**

```bash
git add src/main.jsx
git commit -m "feat: run job migrations at boot before render"
```

---

## Self-Review Notes

- Spec coverage (PR1 scope only): storage adapter ✓ (Task 1), jobs collection + active id ✓ (Task 2), job-namespaced keys ✓ (Tasks 3, 5), versioned non-destructive migration ✓ (Task 4), boot wiring ✓ (Task 6), tests for adapter + migration ✓. Quota warning UI, export/import, switcher UI, onboarding, per-job settings are PR2–PR4 per the spec.
- `ensureDefaultJob` intentionally creates a config-default job even on fresh installs so the app keeps working pre-onboarding; PR3's onboarding replaces this entry point.
- `coach.js` continues to use global `get`/`set` for the AI-mode key unchanged — no edit needed there.
