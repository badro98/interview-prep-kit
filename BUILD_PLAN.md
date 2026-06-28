# Interview Prep Kit — Build Plan

Architecture spec for the interview prep app. For setup and usage, see [README.md](./README.md).

---

## Stack

- **Vite + React + Tailwind** — fast local dev
- **Web Speech API** — browser-native transcription in the Audio tab (Chrome required)
- **MediaRecorder API** — audio capture
- **IndexedDB** (via `idb`) — stores audio blobs + transcripts
- **localStorage** — flashcard progress, context overrides, advisor threads, custom context entries

## AI inference — API mode default, paste fallback

- **API mode (default):** local Express proxy with `GEMINI_API_KEY` (swap `server/gemini.js` for Claude, OpenAI, etc.). Run `npm run dev`.
- **Paste mode (fallback):** copy assembled prompts to clipboard; paste reply back. Toggle in header or use `npm run dev:frontend`.

Everything goes through `src/lib/coach.js`.

## Context — flexible, not a fixed file set

Optional starter templates live in `context/`. Users can paste, upload (`.md`/`.txt`), or add custom entries in the Context tab without touching disk. See `context/README.md`.

**Roadmap:** zero-context first run with full upload-from-UI flow.

---

## Running locally

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY required
npm run dev            # vite + proxy
```

Open http://localhost:5173 in Chrome.

---

## Implemented features

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Stage-by-stage prep docs | Done |
| 2 | Behavioral / situational flashcards + coaching | Done |
| 3 | Audio record + transcribe + score | Done |
| — | Prep advisor chat + action proposals | Done |
| — | Interview recording upload + debrief | Done |
| — | Context tab paste + file upload | Done |
| 4 | Take-home brainstorm workspace | Not implemented |
| — | First-run context upload wizard | Planned |

---

## Customization workflow

1. Clone the template
2. `cp .env.example .env` and add [Gemini](https://aistudio.google.com/apikey) (+ optional [AssemblyAI](https://www.assemblyai.com/dashboard/signup))
3. Add context via Context tab and/or `context/`
4. Edit `interview.config.js`
5. Run [PROMPT.md](./PROMPT.md) to regenerate `generated/`
6. `npm run dev`
