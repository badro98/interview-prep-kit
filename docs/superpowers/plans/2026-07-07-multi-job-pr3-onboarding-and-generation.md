# Multi-Job PR3 — Onboarding Wizard, Profile, In-App Generation

**Spec:** docs/superpowers/specs/2026-07-06-multi-job-support-design.md (PR3 phase)
**Branch:** `multi-job-pr3-onboarding` off `multi-job-pr2-switcher` (stacked; PR base = `multi-job-pr2-switcher`)
**Goal:** First-run onboarding wizard (name → profile → first job → stages → attach profile → generate), a shared candidate profile, in-app generation of prep docs + flashcards through `coach()`, and "+ New job" upgraded to the wizard. Also lands three deferrals: fresh installs no longer auto-create a job, migration stale-overwrite guard, demo resync on version bump.

## Global constraints

- Plain JavaScript/JSX only. Only `storage.js` touches localStorage; only `db.js` touches IndexedDB.
- Key shapes: existing `job:<id>:<key>` unchanged. New GLOBAL keys: `profile:name`, `profile:contextEntries`. New JOB FIELD (not storage key): `job.profileRefs: string[]` (ids of attached profile entries).
- Existing exported signatures unchanged (`coach()`, store.js, db.js, jobs.js). New exports allowed.
- Existing-user invariant: a browser with legacy flat state OR an existing jobs collection boots exactly as PR2 — the wizard appears ONLY when `getJobs().length === 0` after migration.
- Suite green + build green after every task. One commit per task.

## Task 1 — Boot semantics: fresh installs get the wizard, not a phantom job

**Files:** `src/lib/migrate.js`, `src/lib/store.js`, `src/main.jsx`, `src/App.jsx`, `src/lib/__tests__/migrate.test.js`

1. `migrate.js` `runMigrations()`: only call `ensureDefaultJob()` (and copy keys) when legacy flat keys exist. Fresh install (no legacy keys, no jobs): stamp `schemaVersion`, create NO job, return `{ migrated: false, jobId: null }`. Existing jobs collection (schema already current): unchanged. `main.jsx`: skip `backfillJobIds` when `jobId` is null.
2. Stale-overwrite guard (deferred from PR1): in the copy loop, skip a legacy key when the job-scoped destination already has a value (`storage.get(jobKey) !== null`) — prevents a failed-then-retried migration from clobbering values written in between.
3. Demo resync (deferred PR2 finding, cheap version): `applyDemoLocalReset(version)` in store.js — when the version bumps, ALSO delete the jobs collection + activeJobId keys (global `jobs`, `activeJobId`) so the next boot… wait, boot already ran. Instead: return a flag and have `App.jsx` handle it — simplest correct shape: move the demo check into `main.jsx` BEFORE `runMigrations()`: if `DEMO?.localStateVersion` is set and differs from the stored stamp, clear ALL `iprep:` state (localStorage keys via `storage.listKeys("")` + remove), stamp the new version, then let `runMigrations()` run on the clean slate. Because demo context/generated files exist and config STAGES carry `file` props, the demo needs a seed-backed job: after migrations, when DEMO is set and no jobs exist, call `ensureDefaultJob()`. Remove the old `applyDemoLocalReset` call from `App.jsx` and the function from `store.js` (grep consumers; demo/interview.config.js still provides DEMO). Net: `npm run demo:setup` + reload = clean demo job from the CURRENT (demo) config — fixes the stale role/company demo bug.
4. Tests: fresh install → no jobs, schema stamped; legacy state → migrated job (existing tests keep passing); retry-after-partial-failure does not overwrite a newer job-scoped value (new guard); demo version bump wipes and reseeds one seed-backed job.

**Commit:** `feat: show onboarding on fresh installs; harden migration; demo resync`

## Task 2 — Profile module + context integration

**Files:** `src/lib/profile.js` (new), `src/lib/context.js`, `src/lib/jobs.js`, `src/lib/__tests__/profile.test.js` (new)

1. `profile.js` (global, NOT job-scoped; all through storage.js):
   - `getProfileName()` / `setProfileName(name)` (`profile:name`; `getProfileName()` falls back to `APP.candidateName`).
   - `getProfileEntries()` → `[{ id, name, content, updatedAt }]`; `addProfileEntry({name, content})` (id `prof-<ts>-<rand>`), `updateProfileEntry(id, patch)`, `removeProfileEntry(id)` (`profile:contextEntries`).
2. `jobs.js`: `createJob` accepts optional `profileRefs` (validated array of strings, default `[]`) and stores it on the job; `importJob` validates `profileRefs` if present (array of strings) and filters to ids that exist in this browser's profile (dangling refs from another machine are dropped silently); export round-trips the field automatically via the job record.
3. `context.js` `getActiveContextBlocks()`: insert profile-attached blocks between builtin and custom: for each `getActiveJob()?.profileRefs` id that exists in `getProfileEntries()`, emit `{ name: id, label: entry.name + " (profile)", content, source: "profile", enabled: !disabled.has(id) }` — the existing job-scoped disabled-set mechanism gives per-job toggles for free. `getContext()` and `getContextSummary()` inherit.
4. `interview.config.js` `buildAdvisorSystem(job)` / `buildSpeakerMappingPrompt(job)`: candidate name now `getProfileName()`… config can't import lib code cleanly (root file, avoid cycles: profile.js imports config for APP fallback). Instead both builders accept the name as part of the existing APP fallback: change to read `job.candidateName ?? APP.candidateName`; `systemPrompt.js`/`transcribePrompt.js` call sites pass `{ ...getActiveJob(), candidateName: getProfileName() }`. Keep it minimal.
5. Tests: profile CRUD round-trip; context blocks include attached-and-existing refs only (dangling id dropped); per-job disable of a profile block doesn't affect another job; importJob drops dangling profileRefs.

**Commit:** `feat: shared candidate profile with per-job attachment`

## Task 3 — Generation module

**Files:** `src/lib/generate.js` (new), `src/lib/__tests__/generate.test.js` (new)

1. `generateStageDoc(stage)` → `coach({ task: stage.regenTask, includeContext: true })`; returns `{ mode, text?, prompt? }` passthrough. On api mode, caller saves via `setDocOverride(stage.id, text)`. Provide `saveStageDoc(stageId, markdown)` thin wrapper (uses store.js) so the wizard doesn't import store directly.
2. `buildFlashcardsTask(job)` → prompt asking for 20–25 role-specific cards as STRICT JSON array `[{category, question, referenceAnswer, keyPoints[]}]` (categories limited to behavioral|situational|role-specific), grounded in context, no markdown fences.
3. `parseFlashcards(text)` → tolerant parse (strip fences if present, JSON.parse, validate shape per card, drop invalid cards, cap 30, prefix ids `gen-<ts>-<i>`) → `{ cards, dropped }`. Throws `Error("Could not parse flashcards")` only when nothing valid.
4. `generateFlashcards(job)` → coach() with the task; api mode returns parsed cards (caller persists via `addCustomCards`); paste mode returns `{ mode: "paste", prompt }`.
5. Tests (mock `coach` via vi.mock): stage doc passthrough; parseFlashcards happy path, fenced JSON, partial-invalid (drops), garbage (throws); generateFlashcards api path returns cards.

**Commit:** `feat: in-app generation of prep docs and flashcard decks`

## Task 4 — Onboarding wizard UI

**Files:** `src/features/onboarding/Onboarding.jsx` (new), `src/features/onboarding/steps.js` (new, pure step-state helpers if useful), `src/App.jsx`

1. `App.jsx`: `const [needsOnboarding, setNeedsOnboarding] = useState(getJobs().length === 0)`. When true render `<Onboarding onComplete={(jobId) => { handleJobChange(jobId); setNeedsOnboarding(false); }} />` INSTEAD of header+tabs (full-screen). Also `onSkipSeed` path (below) completes the same way.
2. Wizard steps (single component, step state, back/next, ink-palette full-screen layout consistent with the app):
   - **Welcome** — app pitch line + "your name" input (pre-filled from `getProfileName()`); saves via `setProfileName`. Secondary actions: "Use the repo's sample setup" (visible only when config STAGES carry seed files → creates `ensureDefaultJob()`-equivalent seed-backed job via `createJob({ role: APP.role, company: APP.company, stages: STAGES, advisorStarters: ADVISOR_STARTERS })`, completes immediately) and "Import a job export (.json)" (file input → `importJob` → complete with that job active).
   - **Profile** (optional, skippable) — add resume / stories / portfolio as profile entries: name + textarea, plus `.md`/`.txt` file upload (FileReader, same pattern as Context tab — read it first). List added entries, remove.
   - **Job** — role + company (required), job description textarea (optional) + "Fetch from URL" using the existing `src/lib/fetchUrl.js` path (read how Context/Advisor use it; degrade gracefully when proxy is down: show error, keep manual paste).
   - **Stages** — editable list initialized from `STAGE_PRESETS`: rename title/subtitle, remove, add ("Custom stage" with generated id `stage-<rand>`; default regenTask template string interpolating the title), reorder (up/down buttons — no drag dependency).
   - **Attach profile** — checkboxes for each profile entry (default all checked), skipped automatically when no profile entries exist.
   - **Generate** — creates the job first (`createJob({ role, company, stages, advisorStarters: ADVISOR_STARTERS, profileRefs })`, `setActiveJobId`; JD saved as a job custom context entry named "Job description" via `addCustomContextEntry` AFTER activation), then per-stage generation list + flashcards row, each with status (pending/running/done/error+Retry). API mode: run sequentially via `generateStageDoc`/`generateFlashcards`, save results (`saveStageDoc`, `addCustomCards`). Paste mode: each row gets "Copy prompt" + paste-back textarea (reuse CoachPasteModal or inline equivalent — read it and pick the lighter fit). "Skip generation" and per-row skip always available; "Finish" enabled once every row is done/skipped/error-acknowledged. Failures never lose completed rows.
3. IMPORTANT context subtlety: generation must run with the NEW job active so `coach()`'s `getContext()` picks up the JD entry + attached profile refs. Activate before generating (previous point handles it) — note there are no other tabs mounted, so no cross-job flash.
4. No unit tests for the wizard UI; suite + build must stay green.

**Commit:** `feat: first-run onboarding wizard with in-app prep generation`

## Task 5 — "+ New job" enters the wizard; Context tab shows profile blocks

**Files:** `src/components/JobSwitcher.jsx`, `src/App.jsx`, `src/features/onboarding/Onboarding.jsx`, `src/features/context/Context.jsx`

1. Switcher "＋ New job": replace the inline role/company mini-form with launching the wizard as a full-screen overlay starting at the **Job** step (profile exists already; Welcome skipped; back stops at Job). Wizard gains props `{ mode: "firstRun" | "addJob", onComplete, onCancel }` — addJob shows a Cancel affordance returning to the app (first-run has none). App owns `const [addingJob, setAddingJob] = useState(false)`.
2. `Context.jsx`: render `source: "profile"` blocks with a small "profile" badge next to the label and the standard enable/disable toggle; profile blocks are read-only here (editing lives in PR4's job settings + a future profile editor) — no edit/delete buttons for them. Read the component first and follow its list idiom.
3. Suite + build green.

**Commit:** `feat: launch wizard from the switcher; surface profile context blocks`

## Task 6 — Verification (controller-run)

Browser: fresh install → wizard appears (no phantom job); complete full flow with paste-mode generation stubs (no API keys in the checkout: verify API mode gracefully errors per row and paste-mode copy/paste path works with a hand-pasted doc); sample-setup path yields the PR2-identical seed job; import-json path; "+ New job" from switcher enters wizard at Job step and cancels cleanly; JD + attached profile entries visible in Context tab and included in the header count; per-job profile-block toggles isolated; legacy-state boot still migrates straight to tabs (no wizard); demo resync smoke via localStorage stamp manipulation; console clean. Full suite + build. Then whole-branch review → fixes → stacked PR.

## Notes

- `job:none:` bucket: with fresh installs job-less until wizard completes, nothing mounts the tabs/store paths pre-completion; jobKey's "none" fallback stays theoretical. Re-check in review anyway.
- importJob quota-return deferral stays open (PR4/5) unless trivially foldable into Task 2's importJob touch.
