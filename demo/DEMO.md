# Demo data (screenshots only)

Early-stage sample: **Osama Badr** prepping for a **Product Quality Analyst** role at **Dunder Mifflin Co**. Only **recruiter-call notes** are filled in; other context files are still placeholders. Interviewer names are from *The Office*:

| Stage | Character |
|-------|-----------|
| Recruiter | Pam Beesly |
| Hiring Manager | Jim Halpert |
| Onsite | Dwight Schrute · Oscar Martinez |
| Final | Michael Scott |

Only **Stage 1 prep doc** is populated. Stages 2–5 show template placeholders until you add resume, JD, and stories.

Demo walkthrough video: [`demo/demo-walkthrough.mp4`](demo/demo-walkthrough.mp4) (also embedded in the README).

```bash
npm run demo:setup && npm run dev
```

**Warning:** running demo setup resets the app's browser data (jobs, profile, recordings) on next load, to resync with the demo config — export your jobs from Manage jobs first if you have real data.

That reset also reseeds one job from the demo config, so the onboarding wizard is **skipped** (it only shows when no jobs exist) — the app opens straight into Prep Docs for that job. The header switcher shows a single entry, **Product Quality Analyst — Dunder Mifflin Co**; use **＋ New job** there if you want to add more jobs alongside the demo one.

**Suggested screenshot tabs:** Context (recruiter notes + empty placeholders), Prep Docs (recruiter filled / HM template), Flashcards (template deck), Advisor (early-stage starter prompts).
