# Multi-Job PR5 — Docs & Demo Refresh

**Spec:** docs/superpowers/specs/2026-07-06-multi-job-support-design.md (PR5 phase)
**Branch:** `multi-job-pr5-docs` off `multi-job-pr4-job-settings` (stacked; PR base = `multi-job-pr4-job-settings`)
**Goal:** Documentation matches the product. The README leads with the onboarding-first, multi-job workflow; the old config-file/PROMPT.md path is repositioned as a power-user alternative; demo and context docs updated; a short "multiple jobs" section explains switcher/settings/profile/export.

## Global constraints

- Docs-only PR: README.md, PROMPT.md, context/README.md, demo/DEMO.md, interview.config.js comments. NO source-code behavior changes. `npm run build` + `npx vitest run` stay green (should be untouched).
- Keep the author's voice: first-person, direct, no marketing fluff. Match the existing README's tone and structure style (tables for enumerations, short sections).
- Accuracy discipline: every claim must be true of the current head (verify against the app, not memory). The demo video link/section stays (still accurate for the seed job).
- Do not oversell: paste mode still exists, proxy still required for API mode, Chrome still required for the Audio tab.

## Task 1 — README + PROMPT + context/README rewrite

**Files:** `README.md`, `PROMPT.md`, `context/README.md`, `interview.config.js` (comments only)

1. README changes (keep overall skeleton; rewrite affected sections):
   - Intro: add one line — set up multiple jobs from an in-app onboarding flow; no config editing required to start.
   - Quick start: unchanged commands, but after `npm run dev` say the app opens with an onboarding wizard (name → resume/stories → job + JD → stages → generate prep in-app). Mention the two shortcuts: sample setup and import.
   - "What's in the app" table: add a Jobs row (switcher, Job settings, Manage jobs: rename/archive/export/import/delete).
   - "Adding your context": lead with in-app (onboarding + Context tab + profile entries shared across jobs); repo `context/` files become "seed files for the sample setup" — still supported, clearly secondary.
   - "Customizing for your interview" section: RENAME to "Power-user path: config + PROMPT.md" — still valid for the seed job; state plainly that most users should use the in-app flow now.
   - New short section "Multiple jobs": switcher, per-job isolation (docs/flashcards/advisor/recordings), profile attachment, export/import JSON (mention audio recordings are not exported), storage note (everything in your browser; export before clearing site data; quota banner).
   - Project structure + architecture diagram: adjust labels if inaccurate (context/ = seed files; add jobs/profile to the browser box). Keep mermaid.
2. PROMPT.md: reframe headline as the power-user/seed-job path; add a first paragraph pointing to in-app onboarding as the default; keep the prompts (they still work for the seed job).
3. context/README.md: clarify these files power the sample setup / seed-backed job; in-app profile + Context tab are the primary path.
4. interview.config.js top comment: note the config now provides DEFAULTS + presets (APP fallbacks, STAGE_PRESETS, seed STAGES) and that per-job data lives in the browser via the app UI.

**Commit:** `docs: README and guides lead with the in-app multi-job workflow`

## Task 2 — Demo docs + final consistency sweep

**Files:** `demo/DEMO.md`, `scripts/setup-demo.sh` (comments/echo only), any missed doc references

1. demo/DEMO.md: describe what demo:setup now does (wipes browser state on next load — warning already present; seeds the Dunder Mifflin job via the demo config); update any stale references to pre-multi-job behavior/screens (read the file and the demo config first).
2. Sweep: `grep -rn "interview.config" README.md PROMPT.md context/ demo/` and every doc mention of "edit the config" — ensure each is either in the power-user section or updated. Check `.env.example` comments still accurate. Check package.json script list in README matches reality.
3. `npx vitest run` + `npm run build` (unchanged, but run them).

**Commit:** `docs: refresh demo guide and sweep stale workflow references`

## Task 3 — Verification (controller-run)

Read the final README top-to-bottom as a newcomer; confirm the described flow matches the app built at this head (spot-check claims against the running app if uncertain). Whole-branch review (docs accuracy review, lighter than code review) → fixes → stacked PR.
