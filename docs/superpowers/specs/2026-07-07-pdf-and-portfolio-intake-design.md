# PDF Resume Upload + Portfolio Link Intake — Design

**Date:** 2026-07-07
**Status:** Approved

## Goal

Two new ways to get candidate context into the app, in both existing intake
surfaces (onboarding Profile step and the per-job Context tab):

1. **PDF upload** — accept `.pdf` files (resumes) alongside the current
   `.md`/`.txt` upload; the backend converts the PDF to clean markdown.
2. **Portfolio link** — paste a URL (portfolio, personal site, LinkedIn-style
   page); the app fetches it, parses the page to text, and saves it as an
   entry.

## Decisions

- **Conversion path: Gemini.** The Express proxy sends the PDF to Gemini
  (`gemini-2.5-flash` reads PDFs natively, including scanned/image-only ones)
  and gets markdown back. Requires `GEMINI_API_KEY`; when the key is missing
  the route returns a clear actionable error instead of degrading — the same
  posture as the other Gemini routes.
- **Placement: both intake spots.** Onboarding Profile step and Context tab
  get identical affordances via shared helpers.
- **Portfolio parsing reuses `/api/fetch-url`.** The existing route already
  does SSRF-guarded fetch + HTML→text (40k-char cap). No backend change.

## Backend

### `server/gemini.js`
- New `pdfToMarkdown(buffer)` — base64 `inlineData` (`application/pdf`) +
  instruction: convert the document to clean markdown, preserve headings and
  structure, no commentary. Returns the markdown string.

### `server/index.js`
- New `POST /api/extract-pdf`:
  - Reuses the existing multer memory storage; single file field `file`.
  - Rejects non-PDF uploads (mimetype/extension check) with 400.
  - Caps at 10 MB (400 with a friendly message; Gemini inline limit is 20 MB
    so 10 MB leaves headroom).
  - Returns `{ text }` on success.
  - When `!isConfigured()`: 503 with `error` naming `GEMINI_API_KEY`.

## Frontend

### `src/lib/extractPdf.js` (new, mirrors `src/lib/fetchUrl.js`)
- `extractPdfText(file)` — FormData POST to `/api/extract-pdf`, returns
  `{ text }`; throws with the server's `error` message on failure.

### `src/lib/entryFile.js` (new shared helper)
- `readEntryFile(file)` — single intake path both components call:
  PDF → `extractPdfText`; `.md`/`.txt` → FileReader (current behavior).
  Returns `{ name, content }` where `name` is the filename minus extension.
- `entryNameFromUrl(url, title)` — page title if present, else hostname.
  (Pure; unit-tested.)

### Onboarding Profile step (`src/features/onboarding/Onboarding.jsx`)
- Upload input accepts `.pdf` additionally; PDF path shows a "Converting…"
  pending state (async, unlike the instant text path) and inline error text
  on failure.
- New portfolio-URL row (input + Fetch button) modeled on the JobStep
  job-description fetch: `isProxyReachable()` guard, `fetchUrlContent(url)`,
  saves a profile entry via `addProfileEntry`.

### Context tab (`src/features/context/Context.jsx`)
- Same two affordances for per-job custom entries, calling the same shared
  helpers.

## Error handling

- Proxy offline → existing `isProxyReachable()` message pattern ("run npm run
  dev").
- Key missing → surface the 503 message ("PDF conversion needs
  GEMINI_API_KEY in .env").
- Non-PDF / oversized → inline error under the control, no entry created.
- URL fetch failures → existing fetch-url error surface (invalid URL, private
  host blocked, non-HTML).

## Testing (repo convention: lib logic only, vitest)

- `src/lib/__tests__/extractPdf.test.js` — mocked fetch: success, 503
  key-missing message propagation, non-OK error propagation.
- `src/lib/__tests__/entryFile.test.js` — `entryNameFromUrl` cases;
  `readEntryFile` routing (PDF → extract path, text → reader path) with
  mocks.

## Secrets

`GEMINI_API_KEY` / `ASSEMBLYAI_API_KEY` come from the developer's local
`.env` (gitignored; copied from the private `osama-interview-prep` repo).
Nothing key-related is committed; `.env.example` already documents the vars.

## Out of scope

- OCR fallback without a key (keyless users get a clear error, not a
  degraded conversion).
- DOCX or other formats.
- Gemini post-processing of fetched portfolio pages (raw parsed text is
  saved; entries remain editable).
