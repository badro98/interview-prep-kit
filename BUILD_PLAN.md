# Interview Prep Kit — Build Plan

Original architecture spec for the interview prep app. For setup and usage, see [README.md](./README.md).

A local-first app to prep for any interview. Feed it your resume, JD, portfolio, and call notes; it generates stage-by-stage prep docs, behavioral flashcards, an audio record-and-coach loop, a prep advisor chat, and interview recording transcription.

---

## Stack

- **Vite + React + Tailwind** — fast local dev
- **Web Speech API** — browser-native transcription in the Audio tab (Chrome required)
- **MediaRecorder API** — audio capture
- **IndexedDB** (via `idb`) — stores audio blobs + transcripts
- **localStorage** — flashcard progress, generated-doc cache, context overrides, advisor threads

## AI inference — two modes, pluggable via `coach()`

- **Paste mode (default, zero setup):** the app assembles the full prompt (context + task) and copies it to the clipboard. Paste into Cursor, Claude Code, Codex, or any LLM chat; paste the reply back. No API key, no cost.
- **API mode (optional):** if `GEMINI_API_KEY` is in `.env`, route through a local Express proxy (`server/`) using the Google Gemini SDK. Optional `ASSEMBLYAI_API_KEY` for speaker diarization on large recordings. Keys stay server-side.

Everything goes through `src/lib/coach.js` — flipping modes is a one-line change there.

## Seed content (build-time / one-time generation)

Prep docs in `/generated/prep-*.md` and the starter deck in `/generated/flashcards.json` are loaded at build time. Customize them by:

1. Filling in `/context/*.md`
2. Editing `interview.config.js` (stages, title, advisor prompt)
3. Running the prompt in [PROMPT.md](./PROMPT.md) with your AI assistant

Interactive loops (regenerate, flashcard coaching, audio scoring, advisor chat) use `coach()` at runtime.

---

## Project structure

```
interview-prep-kit/
├── context/                  # YOUR raw materials — source of truth
│   ├── resume.md
│   ├── job-description.md
│   ├── portfolio.md
│   ├── recruiter-call.md
│   ├── intel.md
│   └── experiences.md
├── generated/                # Seed prep docs + flashcards (customize after clone)
├── interview.config.js       # App title, stages, advisor — edit for your interview
├── server/
│   ├── index.js              # Express proxy
│   ├── gemini.js             # Gemini client
│   ├── assemblyai.js         # Optional diarization
│   └── transcribe.js         # Interview recording pipeline
├── src/
│   ├── lib/
│   │   ├── coach.js          # paste vs API entry point
│   │   ├── context.js        # loads /context, assembles grounding block
│   │   ├── claude.js         # frontend fetch wrapper to proxy (legacy name)
│   │   ├── db.js             # IndexedDB for recordings
│   │   └── store.js          # localStorage helpers
│   ├── features/
│   │   ├── prep-docs/        # Stage docs + interview recording upload
│   │   ├── flashcards/
│   │   ├── audio/
│   │   ├── advisor/
│   │   └── context/          # UI to toggle/edit context sources
│   └── App.jsx
├── .env.example
└── package.json              # dev = paste mode; dev:api = vite + proxy
```

The `context/` folder is the heart of it. Every AI feature reads those files as grounding.

---

## Implemented features

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Stage-by-stage prep docs | Done |
| 2 | Behavioral / situational flashcards + coaching | Done |
| 3 | Audio record + transcribe + score | Done |
| — | Prep advisor chat + action proposals | Done |
| — | Interview recording upload + debrief | Done |
| 4 | Take-home brainstorm workspace | Not implemented |

---

## Context loading

`src/lib/context.js` reads all files in `/context` at build time and merges runtime overrides from localStorage. `getContext()` returns the assembled grounding string prepended to every AI call.

`server/context.js` reads the same files from disk at runtime for transcription summaries (fallback when the client doesn't send a context block).

To improve any output: edit markdown in `/context/` or use the Context tab — no code changes required.

---

## Running locally

```bash
npm install
npm run dev          # paste mode — no keys
npm run dev:api      # API mode — needs .env with GEMINI_API_KEY
```

Open http://localhost:5173 in Chrome. For API mode: `cp .env.example .env` first.

---

## Customization workflow

1. Clone the template
2. Fill `context/*.md` with your materials
3. Edit `interview.config.js` (role, company, stages)
4. Run [PROMPT.md](./PROMPT.md) in your AI assistant to regenerate `generated/`
5. `npm run dev` and prep

Keep enriching `experiences.md` as you remember stories and metrics.
