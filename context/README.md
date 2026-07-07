# Context — your interview materials

The AI features (prep docs, flashcards, advisor, audio scoring) ground every response in **your** background. You do **not** need the files in this folder — they exist to power the **sample setup** (the seed job baked into `interview.config.js`, loaded via **Use the repo's sample setup** in onboarding). Jobs you create yourself never read from this folder.

## Primary path: in-app

1. **Onboarding / profile** — first run (or **＋ New job**) walks you through a profile (resume/stories, saved in your browser and shared across every job) and job-specific details.
2. **Context tab (in the app)** — paste text, upload a `.md` / `.txt` file, or add custom entries. Saved in your browser; works without editing this folder.

## This folder: sample-setup seed data

Drop any markdown into `context/` (rename, delete, or add files) to change what **Use the repo's sample setup** loads. Restart `npm run dev` after changes so Vite rebundles them.

## Optional starter templates

The repo ships example files you can use, ignore, or replace:

| File | Use it for |
|------|------------|
| `resume.md` | Resume or career summary |
| `job-description.md` | Target role JD + how you map to it |
| `portfolio.md` | Projects, side work, tools you use |
| `recruiter-call.md` | Recruiter notes, pipeline, feedback |
| `intel.md` | Company/role research, HM prep, questions to ask |
| `experiences.md` | STAR stories, metrics, story bank |

**Use whatever matches your process.** One combined `everything.md` is fine — add it via the Context tab or replace these files entirely.

## Tips

- More metrics and concrete stories → better coaching.
- Toggle sources on/off in the **Context** tab without deleting files.
- Overrides in the Context tab are stored locally, not written back to disk.
