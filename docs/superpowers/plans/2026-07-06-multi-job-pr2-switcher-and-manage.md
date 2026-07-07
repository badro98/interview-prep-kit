# Multi-Job PR2 — Job Switcher, Per-Job Scoping, Manage Jobs

**Spec:** docs/superpowers/specs/2026-07-06-multi-job-support-design.md (PR2 phase)
**Branch:** `multi-job-pr2-switcher` off `multi-job-support` (stacked; PR base = `multi-job-support`)
**Goal:** Make multiple jobs actually usable: a header switcher, every tab scoped to the active job, a manage view (rename / archive / delete / export / import), and the PR1 carried-forward fixes (delete data cleanup, `byJob` index reads, quota banner).

## Global constraints

- Plain JavaScript/JSX only — no TypeScript syntax.
- Only `src/lib/storage.js` touches localStorage; only `src/lib/db.js` touches IndexedDB.
- Job-scoped key shape `job:<jobId>:<legacy key>` is fixed (PR1 migration wrote it; do not change).
- Feature files MAY change in this PR (unlike PR1), but keep edits minimal and match existing style/idiom (Tailwind ink/accent palette, small function components in the same file).
- `src/lib/store.js` public API unchanged. `src/lib/db.js` and `src/lib/jobs.js` may gain new exports; existing signatures unchanged.
- Seed-backed inference: a job is "seed-backed" iff any of its stages has a `file` property. Seed-backed jobs use the repo's `generated/` + `context/` files; non-seed jobs never see them. No schema bump.
- App must remain runnable (`npm run dev`) and buildable (`npm run build`); full suite `npx vitest run` green after every task.
- One commit per task, message given in the task.

## Task 1 — db.js: byJob index reads, per-job purge

**Files:** `src/lib/db.js`, `src/lib/__tests__/db.test.js`

1. Switch `getAllAttempts`, `getAllRecordings`, `getRecordingByStage` to `getAllFromIndex(store, "byJob", jobId)` instead of `getAll` + filter. Records written before the backfill ran may lack `jobId` — the backfill stamps them at boot, so index reads are safe; keep `replaceRecordingForStage`'s delete loop as is (it already filters by job).
2. New export `deleteJobRecords(jobId) → Promise<{attempts, recordings}>` — deletes all rows in both stores whose `jobId === jobId` (use the index; collect keys, delete in one readwrite transaction per store).
3. Delete the vacuous `count >= 0` assertion in the backfill test (the following real assertion stays).
4. Tests (extend db.test.js, same fresh-import + `new IDBFactory()` pattern): index reads return only active-job rows; `deleteJobRecords` removes exactly the target job's rows in both stores and leaves the other job's rows.

**Commit:** `feat: read and purge IndexedDB records via the byJob index`

## Task 2 — jobs.js: presets, delete-with-data, export/import; config: parameterized prompt builders

**Files:** `src/lib/jobs.js`, `interview.config.js`, `src/lib/__tests__/jobs.test.js`

1. `interview.config.js`: add `export const STAGE_PRESETS = STAGES.map(({ file, ...rest }) => rest);` (presets carry no seed file). Change `buildAdvisorSystem()` and `buildSpeakerMappingPrompt()` to take a `job` parameter and read `job.role`, `job.company`, `job.stages` (candidate name still from `APP.candidateName`). No other config changes.
2. `jobs.js` new exports:
   - `isSeedBacked(job)` → `!!job?.stages?.some((s) => s.file)`.
   - `deleteJobWithData(jobId)` → removes every localStorage key under `job:<jobId>:` (via `storage.listKeys`), awaits `deleteJobRecords(jobId)` from db.js, removes the job from the collection, and if it was active re-points `activeJobId` to the first remaining job (or removes the key when none remain). Returns `{ removedKeys, attempts, recordings }`.
   - `exportJob(jobId)` → `{ version: 1, kind: "iprep-job", job, state }` where `state` maps each bare `job:<jobId>:`-suffix key (legacy-key part only, e.g. `"flashcards:progress"`) to its stored value. Audio blobs in IndexedDB are NOT exported — document in the JSDoc.
   - `importJob(data)` → validates (`kind === "iprep-job"`, `version === 1`, `job.role`/`job.company` strings, `state` object) and throws `new Error("Invalid job export file")` on any failure; inserts the job under a freshly generated id (never trust the incoming id), writes each state entry under the new id's namespace, appends to the collection, returns the new job. Does NOT change the active job.
3. Tests: preset shape (no `file` keys); `isSeedBacked` true for config-STAGES job, false for preset job; delete purges localStorage keys + IDB rows (seed both, use fake-indexeddb) and re-points/removes activeJobId; export→import round-trip lands state under the new id and leaves the source job untouched; import rejects malformed payloads; parameterized `buildAdvisorSystem(job)` embeds the job's role/company/stage titles.

**Commit:** `feat: job presets, delete-with-data, and JSON export/import`

## Task 3 — Per-job content seams: stages, deck, context

**Files:** `src/features/prep-docs/stages.js`, `src/features/prep-docs/PrepDocs.jsx`, `src/features/flashcards/deck.js`, `src/lib/context.js`, `src/lib/__tests__/context.test.js` (new)

1. `stages.js`: replace the `STAGES` re-export with `getStages()` returning `getActiveJob()?.stages || []`. `getStageDoc(stageId)` finds the stage there; when the stage has a `file`, load the bundled markdown as today; when not, return `"# No prep doc yet\n\nUse **Regenerate** to draft this stage from your context."` (regeneration already writes to the job-scoped override, so the button works unchanged).
2. `PrepDocs.jsx`: swap the `STAGES` import for `getStages()` (call once per render; component remounts on job switch via App's key — no subscription needed).
3. `deck.js`: `getDeck()` and `getOriginalModel()` include seed cards only when `isSeedBacked(getActiveJob())`; custom cards and progress are already job-scoped via store.js. `deckMeta` becomes `getDeckMeta()` with the same gating (update its consumers — grep for `deckMeta`).
4. `src/lib/context.js`: `getContextFiles()` returns `[]` when the active job is not seed-backed (builtin repo files are seed data). Custom entries/overrides/toggles are already job-scoped. Keep `getContext()`'s empty-state string.
5. Tests (`context.test.js`, jsdom): with a preset (non-seed) job active, `getActiveContextBlocks()` contains only custom entries and `getContextFiles()` is empty; with the config-default job, builtin files appear. (Vitest note: `import.meta.glob` works under Vitest with the Vite config — if it returns an empty map in the test environment, assert the non-seed gating only and note it in the test comment.)
6. Check `src/features/audio/Audio.jsx` and `Flashcards.jsx` for `STAGES`/`deckMeta`/seed imports and update the import sites only — no behavior changes beyond the new accessors.

**Commit:** `feat: scope prep docs, flashcard deck, and context files to the active job`

## Task 4 — App shell: switcher, manage modal, quota banner

**Files:** `src/components/JobSwitcher.jsx` (new), `src/components/ManageJobsModal.jsx` (new), `src/App.jsx`

1. `JobSwitcher.jsx`: header dropdown (button shows active job's `role — company`, truncated). Menu lists non-archived jobs (click → `setActiveJobId` + notify parent), then "＋ New job" and "Manage jobs…" rows. "New job" opens a small inline form (role, company required) → `createJob({ role, company, stages: STAGE_PRESETS, advisorStarters: ADVISOR_STARTERS })` → make it active. Close on outside click/Escape (follow CoachPasteModal's patterns).
2. `ManageJobsModal.jsx`: table of all jobs (incl. archived): inline rename (role/company via `updateJob`), archive/unarchive toggle (`updateJob({status})`), delete with typed-confirm ("Delete" button → confirm step naming the job) calling `deleteJobWithData`, per-job "Export JSON" (Blob download named `iprep-job-<role>-<company>.json`), and an "Import job" file input (`importJob`, surface thrown validation error inline). Never allow deleting the last remaining job (disable + tooltip).
3. `App.jsx`: add `activeJobId` state (from `getActiveJobId()`); render `<JobSwitcher>` in the header next to the title; pass a `onJobChange` that updates state; wrap the tab content in `key={activeJobId}` so every feature remounts on switch; refresh the context-summary badge on job change. Add a dismissible quota banner: `storage.onQuotaError(() => setQuotaWarning(true))` registered once in a `useEffect` — banner text suggests exporting jobs from Manage Jobs. Keep header layout intact at laptop widths (the nav already truncates).
4. No new tests (UI; jsdom component tests are out of scope per spec) — but `npx vitest run` and `npm run build` must stay green.

**Commit:** `feat: add job switcher, manage-jobs modal, and storage quota banner`

## Task 5 — Advisor + transcription read the active job

**Files:** `src/features/advisor/systemPrompt.js`, `src/features/advisor/Advisor.jsx`, `src/lib/transcribePrompt.js`, `src/features/prep-docs/InterviewRecording.jsx` (import sites only)

1. `systemPrompt.js`: replace the module-load constant with `export function getAdvisorSystem() { return buildAdvisorSystem(getActiveJob()); }`. Update `Advisor.jsx` call sites (grep `ADVISOR_SYSTEM`).
2. `Advisor.jsx`: starter chips read `getActiveJob()?.advisorStarters || []` instead of config `ADVISOR_STARTERS`.
3. `transcribePrompt.js` / `InterviewRecording.jsx`: wherever config `TRANSCRIBE_STAGES` / `TRANSCRIBE_STAGE_INSTRUCTIONS` / `buildSpeakerMappingPrompt()` are used, derive stages from `getActiveJob().stages` (id/title/subtitle) and pass the job to `buildSpeakerMappingPrompt(job)`. `TRANSCRIBE_STAGE_INSTRUCTIONS` keyed by stage id stays as a config fallback: `TRANSCRIBE_STAGE_INSTRUCTIONS[stage.id] || ""` (preset stage ids match config ids, so instructions still resolve for preset jobs).
4. No new tests; suite + build green.

**Commit:** `feat: build advisor and transcription prompts from the active job`

## Task 6 — Verification (controller-run)

Browser pass on `npm run dev`: default job renders identically to PR1; create a second job via switcher (empty docs with Regenerate placeholder, no seed flashcards, no builtin context files); switch back and forth (state isolated: doc edits, custom context, advisor threads don't leak); rename + archive + export + re-import as third job; delete the second job (localStorage keys + IDB rows gone, active re-points); quota banner smoke (manually invoke handler); console clean. Full suite + build green.

## Carried from PR1 (resolved here)

- deleteJob dangling activeJobId → `deleteJobWithData` re-points (Task 2)
- Orphaned `job:<id>:*` data on delete → purged (Tasks 1–2)
- `byJob` index unused → used (Task 1)
- Vacuous `count >= 0` assertion → removed (Task 1)
- Quota-warning UI for `onQuotaError` → banner (Task 4)

Still deferred: migration stale-overwrite guard (PR3 revisit), `job:none:` bucket (PR3).
