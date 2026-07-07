# Multi-Job PR4 — Job Settings (edit details after creation)

**Spec:** docs/superpowers/specs/2026-07-06-multi-job-support-design.md (PR4 phase)
**Branch:** `multi-job-pr4-job-settings` off `multi-job-pr3-onboarding` (stacked; PR base = `multi-job-pr3-onboarding`)
**Goal:** Everything about a job stays editable after creation: role/company, the stage list (rename/add/remove/reorder + regen prompts), and which profile entries are attached. Removing a stage cleans up its job-scoped state. JD and custom notes remain editable in the Context tab (link to it, don't duplicate).

## Global constraints

- Plain JavaScript/JSX only. Only storage.js touches localStorage; only db.js touches IndexedDB.
- Existing exported signatures unchanged; new exports allowed.
- Seed-backed default job invariant: editing must not silently strip `file` props from seed stages (renames keep `file`; only explicit removal drops a stage).
- The wizard's stage-editing UX and Job Settings' must stay ONE implementation (shared component) — no fork.
- Suite + build green after every task. One commit per task.

## Task 1 — lib: stage-list updates with orphan cleanup

**Files:** `src/lib/jobs.js`, `src/lib/__tests__/jobs.test.js`

1. New export `updateJobStages(jobId, nextStages)`:
   - Validates `nextStages` with the same stage-shape floor as importJob (array, ≥1 entry, string id/title; subtitle/regenTask/file optional strings) — throws `Error("Invalid stages")` on failure.
   - Diffs old vs new stage ids; for each REMOVED id, removes job-scoped keys `prepdoc:override:<id>` and clears the id from `recordings:hasByStage` (via storage, key shape `job:<jobId>:...` — reuse listKeys/remove; recordings flags are one map key, so read-modify-write it). IndexedDB recordings/attempts are NOT deleted (they're keyed by their own ids and become unreachable rows for that stage — document in JSDoc; full purge stays a deleteJobWithData concern).
   - Writes via `updateJob(jobId, { stages })` with defensive copies.
   - Returns the updated job.
2. Tests: happy-path reorder/rename preserves `file` props and overrides; removing a stage deletes its prepdoc override key and its recordings flag but leaves other stages' state; invalid shapes throw; adding a stage leaves existing state untouched.

**Commit:** `feat: editable job stages with orphaned-state cleanup`

## Task 2 — shared StageEditor component (extract from wizard)

**Files:** `src/components/StageEditor.jsx` (new), `src/features/onboarding/Onboarding.jsx`, `src/features/onboarding/steps.js`

1. Extract the wizard's StagesStep list UI into `src/components/StageEditor.jsx` with props `{ stages, onChange }` (controlled; internal rename/remove/add/move handlers call onChange with the next array; keep the monotonic custom-stage label counter inside the editor). Move `buildCustomStage`/`moveStage` consumption accordingly (steps.js keeps the pure helpers; editor imports them).
2. Add an "Advanced" disclosure per stage row: a textarea editing `regenTask` (collapsed by default, small mono text). This appears in BOTH the wizard and settings for free.
3. Wizard's StagesStep becomes a thin wrapper: heading + `<StageEditor>` + footer. Behavior identical (suite + build green; no visual redesign).

**Commit:** `refactor: shared StageEditor with regen-prompt editing`

## Task 3 — JobSettingsModal + entry points

**Files:** `src/components/JobSettingsModal.jsx` (new), `src/App.jsx`, `src/components/JobSwitcher.jsx`, `src/components/ManageJobsModal.jsx`

1. `JobSettingsModal.jsx` — overlay modal (ManageJobsModal's structure), editing the ACTIVE job:
   - Role + company inputs (trimmed, required to save).
   - `<StageEditor>` (from Task 2) seeded with the job's stages.
   - Profile attachment: checkbox list of `getProfileEntries()` against `job.profileRefs` (attach/detach; dangling refs shown nowhere — filter).
   - A note row: "Job description and notes live in the Context tab" with a button that closes the modal and switches to the Context tab (App passes an `onGoToContext` callback).
   - Save: `updateJob(id, { role, company, profileRefs })` + `updateJobStages(id, stages)`; then notify parent (`onSaved`) → App calls handleJobChange(id) so the keyed <main> remounts and header refreshes. Cancel discards. Disable Save while unchanged (cheap dirty check is fine).
   - Removing a stage with an edited doc: confirm inline before save ("Removing <title> deletes its prep doc edits") — one confirm for the save as a whole listing removed stages, not per row.
2. Entry points: switcher dropdown gains "Job settings…" above "Manage jobs…" (opens for active job); ManageJobsModal rows keep rename-only (collection-level) — no change there beyond none.
3. App.jsx: `settingsOpen` state; render modal as sibling of ManageJobsModal; `onGoToContext={() => { setSettingsOpen(false); setTab("context"); }}`.

**Commit:** `feat: job settings modal — edit details, stages, and profile attachment`

## Task 4 — Verification (controller-run)

Browser: edit active job's role/company → header/switcher update; rename a stage → PrepDocs nav updates, doc override survives; remove a stage with an edit → confirm shown, override key gone after save; add a stage → placeholder + Regenerate present; edit a regenTask via Advanced (visible in wizard too); attach/detach profile entry → Context tab + count react; seed job: rename keeps seed doc (file preserved); "Job settings…" reachable from switcher; console clean. Suite + build. Whole-branch review → fixes → stacked PR.

## Notes

- Deferred (carried): speaker-mapping profile name + server prompt threading (server-factoring); demo-wipe severity documented in PR3.
- PR5 (docs/demo refresh) remains the final PR.
