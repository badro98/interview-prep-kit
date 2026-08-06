# Interview Prep Kit

Hi. I built this to fix my own interview prep workflow.

I was juggling notes in Google Docs, practice questions in Claude, prep docs somewhere else — and constantly context-switching between all of it. Every Claude session I had to re-explain which job I was interviewing for and hope I was in the right project.

So I built this instead. One place for everything, always grounded in your resume and the actual job. I put it together in under 24 hours on Cursor to prep for an interview and found it genuinely useful — so here it is.

This is a **local-first** interview prep app. Add your resume, job description, notes, and stories — it generates stage-by-stage prep docs, behavioral flashcards, an audio record-and-coach loop, a chat advisor, and interview recording transcription. Set up one job or several from an in-app onboarding wizard — no config editing required to get started.

You bring your own API keys. Nothing leaves your machine. Feel free to build it out locally and try it for yourself.

## Demo

Here's the app in action — persona is a Product Quality Analyst role (with *The Office* characters as interviewers because why not).

<video src="https://github.com/user-attachments/assets/02873ec3-0298-4550-b8a3-9a59603ed658" controls width="100%"></video>

Try it with sample data:

```bash
npm run demo:setup
npm run dev
```

See [`demo/DEMO.md`](demo/DEMO.md) for what's pre-loaded.

---

## What's in the app

| Tab | What it does |
|-----|--------------|
| **Prep Docs** | One doc per interview stage — editable, regeneratable on demand |
| **Flashcards** | Behavioral deck with AI coaching on your answers |
| **Audio** | Record answers → transcribe → score your structure and delivery |
| **Advisor** | Multi-turn chat that proposes flashcards and context updates |
| **Context** | Paste, upload, or toggle your grounding materials |
| **Jobs** (header switcher) | Jump between jobs; **Job settings…** edits role/company/stages/profile attachments; **Manage jobs…** renames, archives, exports, imports, and deletes jobs |

---

## Quick start

Get a free [Gemini API key](https://aistudio.google.com/apikey) first (required). AssemblyAI is optional.

```bash
git clone https://github.com/badro98/interview-prep-kit.git
cd interview-prep-kit
npm install
cp .env.example .env
# Paste your Gemini key into .env
npm run dev
```

Open the local URL printed in your terminal in **Chrome** (required for Web Speech API in the Audio tab).

The app opens straight into an onboarding wizard: your name → an optional profile (resume/stories, shared across every job) → job + description → interview stages → pick which profile entries to attach (skipped if you added none) → generate prep docs and flashcards in-app. Two shortcuts on the first screen if you'd rather skip typing: **Use the repo's sample setup** (loads the job baked into `interview.config.js`) or **import a job export (.json)**.

Check the proxy is up: http://localhost:3001/api/health

---

## API keys

No keys are included. Sign up with the providers below and paste them into `.env`.

| Variable | Required? | Get a key | Purpose |
|----------|-----------|-----------|---------|
| `GEMINI_API_KEY` | **Yes** | [Google AI Studio](https://aistudio.google.com/apikey) | Chat, coaching, audio scoring, transcription fallback |
| `GEMINI_MODEL` | Optional | — | Default: `gemini-2.5-flash` |
| `ASSEMBLYAI_API_KEY` | Optional | [AssemblyAI](https://www.assemblyai.com/dashboard/signup) | Speaker labels on large interview recordings (>25 MB) |
| `PORT` | Optional | — | Proxy port (default `3001`) |

Both offer generous free tiers — more than enough for interview prep.

**Never commit `.env`** — it's gitignored.

### Swap providers (Claude, ChatGPT, etc.)

The server is wired for Gemini by default ([`server/gemini.js`](server/gemini.js)), but it's a small proxy (~30 lines in [`server/index.js`](server/index.js)). All coaching flows through one `coach()` function in [`src/lib/coach.js`](src/lib/coach.js) — change the server client, not every feature.

---

## Adding your context

You don't need a fixed set of files. The in-app path is primary:

1. **Onboarding / profile** — paste your resume and stories once during setup (or later from **＋ New job**); profile entries are shared across every job, so you attach the relevant ones per job instead of re-pasting them
2. **Context tab** — paste notes, upload `.md` / `.txt`, or add job-specific custom entries (saved in your browser)

The repo's `context/` folder is seed data for **Use the repo's sample setup** in onboarding — not required for your own jobs. See [`context/README.md`](context/README.md) if you want to edit those files directly.

Every AI feature prepends your active context. Better stories → better coaching.

---

## Multiple jobs

Set up a job per interview you're prepping for. Each job keeps its own prep docs, flashcards, advisor history, and audio recordings — nothing bleeds between jobs.

- **Switch jobs** — the header switcher lists your active jobs; **＋ New job** launches the onboarding wizard scoped to a single job (skips the name/profile steps since those already exist)
- **Job settings…** — edit role, company, interview stages, and which profile entries are attached
- **Manage jobs…** — rename, archive/unarchive, export, import, or delete jobs (deleting the last remaining job is disabled)
- **Profile** — your resume/stories live once in a shared profile; attach whichever pieces are relevant to each job
- **Export/import** — Manage jobs exports a job to a JSON file; audio recordings are **not** included (too large for a JSON export, treated as ephemeral practice data). Import brings a job back in under a new id

Everything lives in your browser (localStorage + IndexedDB for audio) — nothing syncs to a server. Export jobs you care about before clearing site data or switching browsers. If storage fills up, a banner appears telling you to export and free up space.

---

## Power-user path: config + PROMPT.md

Most people should just use the in-app onboarding wizard above — it's faster and doesn't touch any files. This path is for the **seed job** (the one baked into `interview.config.js` and `generated/`, loaded via **Use the repo's sample setup**) if you want an AI coding assistant to regenerate its prep docs and flashcards ahead of time.

1. Add context to `context/` (see [`context/README.md`](context/README.md))
2. Edit [`interview.config.js`](interview.config.js) — set the app title, role, company, your name, and interview stages for the seed job
3. Run the drop-in prompt in [PROMPT.md](./PROMPT.md) inside Cursor, Claude Code, or Codex to regenerate the seed job's prep docs and flashcards
4. Restart `npm run dev` after editing files in `context/` or `generated/` (Vite bundles them at build time)

**Using the kit for a real interview?** Keep your personal edits to `context/`, `generated/`, and `interview.config.js` local. A pre-commit hook (installed via `npm install` → `prepare`) blocks committing those paths so a real resume or interviewer names cannot land in a public fork by accident. Intentional seed updates only: `ALLOW_SEED_COMMIT=1 git commit …`.

---

## Paste mode

If you don't want to run the proxy or use API keys, toggle **AI: Paste mode** in the header. It copies a full prompt to your clipboard — paste it into any chat, paste the response back. Most people will use API mode.

Frontend only (no proxy): `npm run dev:frontend`

---

## Project structure

```
interview-prep-kit/
├── context/              # Seed files for the sample setup (optional) + README
├── generated/            # Seed prep docs + flashcards (customize via PROMPT.md)
├── interview.config.js   # Defaults, stage presets, and the seed job's config
├── .githooks/            # pre-commit: blocks personal seed-path commits
├── server/               # Local proxy — calls your Gemini key
├── src/                  # React app — onboarding, jobs, profile, tabs
├── .env.example
└── PROMPT.md
```

---

## npm scripts

| Script | What it does |
|--------|--------------|
| `dev` | Vite + Express proxy (default — use this) |
| `dev:frontend` | Vite only, no proxy (paste mode fallback) |
| `demo:setup` | Load sample data |
| `build` | Production bundle → `dist/` |
| `preview` | Preview production build |
| `server` | Run proxy only |
| `test` | Run the test suite once |
| `test:watch` | Run the test suite in watch mode |
| `prepare` | Point git at `.githooks/` (runs on `npm install`) |

---

## Architecture

```mermaid
flowchart TB
  subgraph browser [Browser]
    UI[React tabs]
    Coach[coach.js]
    Ctx[context.js + Context tab uploads]
    Jobs[jobs.js + profile.js — jobs, profile, local storage]
  end

  subgraph server [Express proxy]
    LLM[gemini.js — swap for Claude/OpenAI]
    AAI[assemblyai.js optional]
  end

  Ctx --> Coach
  Jobs --> Coach
  Coach -->|API default| server
  Coach -->|paste fallback| ExtLLM[External chat]
  LLM --> Env[".env keys"]
```

---

## License

MIT — see [LICENSE](./LICENSE).
