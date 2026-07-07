# Multi-Job Support — Design

**Date:** 2026-07-06
**Status:** Approved
**Goal:** Turn interview-prep-kit from a single-job template (clone + edit config + regenerate externally) into a plug-and-play app that supports prepping for multiple jobs at once, with a full in-app onboarding flow, a job switcher, and per-job editing. Must run locally today and be deployable (static frontend + serverless proxy) later without rework.

## Decisions made (with Osama)

| Decision | Choice |
|----------|--------|
| Deployment target | Local-first AND deployable from day one |
| Job data storage | Browser storage (IndexedDB + localStorage) behind a storage adapter; repo files become optional seed data; JSON export/import per job |
| Doc/flashcard generation | In-app via the existing proxy ("Generate my prep"); PROMPT.md stays as a power-user alternative |
| Context model | Everything per-job, with optional reuse of shared "profile" entries (resume, stories, portfolio) |
| Git-versioned prep docs | Dropped as a primary path; JSON export/import is sufficient (no markdown file-export bridge) |

## Why browser storage

Server-backed files would tie the app to a Node server with disk access, blocking static/serverless deployment. IndexedDB/localStorage behave identically on localhost and on a static host, and keep the "nothing leaves your machine" property of the open-source template. Risks (single-browser data, site-data clearing) are mitigated by per-job JSON export/import. All reads/writes go through one adapter module so a sync backend could slot in later without touching features.

## Data model

```
profile:
  name                     — candidate name (was APP.candidateName)
  contextEntries[]         — { id, name, content, updatedAt }  e.g. resume, stories, portfolio

jobs[]:
  id, role, company, status (active|archived), createdAt
  jobDescription           — stored as a context entry, flagged as the JD
  stages[]                 — { id, title, subtitle, regenTask, transcribeInstructions }
  advisorStarters[]        — per-job starter questions

activeJobId

Per-job namespaced state (today's flat keys gain a job:<id>: prefix):
  context entries (own + attached profile refs), doc content per stage,
  flashcard deck + progress + model overrides, advisor threads,
  recording flags (localStorage) and audio blobs (IndexedDB)
```

**Profile attachment semantics:** a job references profile entries by id (linked — profile edits flow through). "Detach & edit" copies the content into the job for per-job tailoring, mirroring today's builtin-file + override pattern.

**Storage split:** small structured state (jobs list, stages, progress, prefs) in localStorage; large content (context entries, doc bodies, flashcard decks, audio) in IndexedDB. One adapter module (`src/lib/storage.js`) wraps both; feature code never calls `localStorage`/`indexedDB` directly.

## Onboarding wizard

Shown when no jobs exist (replaces the current tabs UI until complete):

1. Welcome + your name
2. Optional profile setup — paste or upload resume, stories, portfolio (`.md`/`.txt`, same paths as today's Context tab)
3. Create first job — role, company, paste JD or fetch from URL (existing `fetchUrl` path)
4. Pick stages — preset pipeline (Recruiter Screen → Hiring Manager → Take-home → Onsite → Final) shown as an editable list: add, remove, rename, reorder. Presets live where `STAGES` lives today, generalized into templates.
5. Attach profile entries — checkboxes for which profile items this job uses
6. **Generate my prep** — app calls the proxy to write one prep doc per stage plus a 20–25 card flashcard deck, grounded in the job's context, with per-stage progress UI. Paste-mode users get the copy-prompt/paste-back loop per artifact instead. "Skip for now" starts the job empty; each doc has a Generate button later.

Adding a subsequent job = steps 3–6 only (profile already exists), reachable from the job switcher.

## Job switcher and management

- Header dropdown: active job name/company, list of jobs, "+ New job", "Manage jobs".
- Manage view: rename, archive, delete (confirm), export job as JSON, import job from JSON.
- All five tabs (Prep Docs, Flashcards, Audio, Advisor, Context) read/write only the active job's namespace. Advisor system prompt and speaker-mapping prompt are built from the active job's role/company/stages instead of the static config.

## Per-job editing ("Job settings")

A settings surface per job: edit role/company/JD, manage stages (add/remove/reorder, edit titles/subtitles, optionally edit regen prompts), manage context entries (add/edit/toggle/detach profile refs), regenerate any stage doc or the flashcard deck.

## What happens to existing pieces

- **interview.config.js** → shrinks to app defaults (title, subtitle) + stage preset templates + prompt-building functions that now take a job object. No per-job data in the file.
- **context/ and generated/ files** → optional seed data. First run offers "import from repo files" (uses today's `import.meta.glob`, one-time copy into storage). context/README.md updated to describe them as seeds.
- **Existing users' localStorage** → one-time migration wraps all flat `iprep:` keys into a first job ("My interview" using current config's role/company) so nobody loses prep state. Migration is versioned (`iprep:schemaVersion`).
- **Demo** → `npm run demo:setup` seeds a demo job through the same import path instead of overwriting root files.
- **PROMPT.md** → rewritten for the new model (seed-file workflow), demoted to power-user path in README.
- **Server** → Express stays for local dev; route handlers factored into plain functions so Vercel/serverless wrappers are a later drop-in, not a rewrite. No deployment work in this project beyond that factoring.

## Error handling

- Generation: per-stage failures are retryable individually; partial success keeps completed docs; onboarding never has to be redone.
- Storage: adapter guards writes (quota errors surface a visible warning + suggest export); JSON import validates shape and versions.
- Migration: idempotent, versioned, and non-destructive (old keys kept until migration confirmed written).

## Testing

Vitest (new — repo has zero tests today): storage adapter round-trips, migration from flat keys, profile attach/detach semantics, context assembly for a job (profile refs + own entries + toggles), stage preset editing, JSON export/import validation. UI smoke coverage where cheap; heavy UI testing out of scope.

## Phasing (multiple PRs, <20 files each)

1. **PR1** — storage adapter, job-namespaced keys, schema version + migration of existing flat state into a default job. App still single-job visually. Tests for adapter + migration.
2. **PR2** — jobs collection, active-job switcher in header, all tabs scoped to active job. Manage-jobs view with export/import.
3. **PR3** — onboarding wizard + in-app generation (API and paste modes), "+ New job" flow.
4. **PR4** — job settings surface (edit job details, stages, context; regenerate).
5. **PR5** — README/PROMPT/demo refresh, seed-import polish.

## Out of scope

Actual deployment config (Vercel project, serverless wrappers), cross-device sync backend, markdown file-export bridge, multi-user/auth.
