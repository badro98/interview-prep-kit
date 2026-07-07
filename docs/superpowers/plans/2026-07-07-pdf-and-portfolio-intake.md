# PDF Resume Upload + Portfolio Link Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept PDF uploads (converted to markdown via Gemini on the proxy) and portfolio-URL fetch as new intake paths in the onboarding Profile step and the per-job Context tab.

**Architecture:** New `POST /api/extract-pdf` route on the existing Express proxy sends the PDF to Gemini as `inlineData` and returns markdown. Client-side, a shared `readEntryFile()` helper routes PDFs to the proxy and `.md`/`.txt` to the existing FileReader path; a shared `normalizeUrlInput()` + existing `fetchUrlContent()` powers URL intake. Both UI surfaces call the same helpers.

**Tech Stack:** Express + multer (already present), `@google/genai` (already present), React, vitest + jsdom. **No new npm dependencies.**

## Global Constraints

- Branch: `pdf-portfolio-intake` (already created; spec committed).
- No new npm dependencies.
- Never commit `.env` or `qa-agent.config.json` (both intentionally untracked).
- Tests are lib-level only (`src/lib/__tests__/`, vitest, jsdom env) — repo convention; no component or server tests.
- Server route error shape is `{ error: string }` with appropriate status — match existing routes.
- Keyless behavior: `/api/extract-pdf` returns 503 naming `GEMINI_API_KEY`; UI surfaces the message verbatim.
- Dev server for manual verification runs vite on port 5175 (`npx vite --port 5175 --strictPort`) + proxy on 3001.

---

### Task 1: Client PDF extraction lib (`extractPdfText`)

**Files:**
- Create: `src/lib/extractPdf.js`
- Test: `src/lib/__tests__/extractPdf.test.js`

**Interfaces:**
- Consumes: `fetch` (browser global), `/api/extract-pdf` (built in Task 3 — mocked here).
- Produces: `extractPdfText(file: File) => Promise<string>` — resolves markdown text; throws `Error` whose `message` is the server's `error` field (or `Could not convert PDF (<status>)`).

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/extractPdf.test.js`:

```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../extractPdf.js";

function mockFetchOnce(response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractPdfText", () => {
  it("posts the file as multipart form data and returns the text", async () => {
    const fetchFn = mockFetchOnce({
      ok: true,
      json: async () => ({ text: "# Resume\n\nQA Engineer" }),
    });
    const file = new File(["%PDF-1.4 fake"], "resume.pdf", { type: "application/pdf" });

    const text = await extractPdfText(file);

    expect(text).toBe("# Resume\n\nQA Engineer");
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/extract-pdf");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get("file")).toBe(file);
  });

  it("throws the server's error message on failure", async () => {
    mockFetchOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "PDF conversion needs GEMINI_API_KEY in .env" }),
    });
    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });

    await expect(extractPdfText(file)).rejects.toThrow(
      "PDF conversion needs GEMINI_API_KEY in .env"
    );
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("no json");
      },
    });
    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });

    await expect(extractPdfText(file)).rejects.toThrow("Could not convert PDF (500)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/extractPdf.test.js`
Expected: FAIL — `Failed to resolve import "../extractPdf.js"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/extractPdf.js`:

```js
// Convert a PDF to markdown via the local proxy (Gemini does the extraction).

export async function extractPdfText(file) {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch("/api/extract-pdf", { method: "POST", body: form });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Could not convert PDF (${res.status})`);
  }

  const { text } = await res.json();
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/extractPdf.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extractPdf.js src/lib/__tests__/extractPdf.test.js
git commit -m "feat: client helper to convert PDFs via the proxy"
```

---

### Task 2: Shared intake helpers (`entryFile.js`, `normalizeUrlInput`)

**Files:**
- Create: `src/lib/entryFile.js`
- Modify: `src/lib/fetchUrl.js` (append `normalizeUrlInput`)
- Test: `src/lib/__tests__/entryFile.test.js`, `src/lib/__tests__/fetchUrl.test.js`

**Interfaces:**
- Consumes: `extractPdfText(file)` from Task 1; `extractUrls(text)` already in `fetchUrl.js`.
- Produces:
  - `readEntryFile(file: File) => Promise<{ name: string, content: string }>` — PDFs via proxy, text via FileReader; `name` = filename minus `.md/.txt/.pdf` extension.
  - `isPdfFile(file) => boolean`, `entryNameFromFile(file) => string`, `entryNameFromUrl(url, title) => string` (title if present, else hostname, else raw input).
  - `normalizeUrlInput(text) => string | null` — first URL in text, else `https://` + trimmed input if that parses, else null.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/entryFile.test.js`:

```js
import { describe, expect, it, vi } from "vitest";

vi.mock("../extractPdf.js", () => ({
  extractPdfText: vi.fn(async () => "# Converted markdown"),
}));

import { extractPdfText } from "../extractPdf.js";
import {
  isPdfFile,
  entryNameFromFile,
  entryNameFromUrl,
  readEntryFile,
} from "../entryFile.js";

describe("isPdfFile", () => {
  it("detects PDFs by mimetype", () => {
    expect(isPdfFile(new File(["x"], "cv", { type: "application/pdf" }))).toBe(true);
  });

  it("detects PDFs by extension when the type is missing", () => {
    expect(isPdfFile(new File(["x"], "cv.PDF", { type: "" }))).toBe(true);
  });

  it("rejects text files", () => {
    expect(isPdfFile(new File(["x"], "notes.md", { type: "text/markdown" }))).toBe(false);
  });
});

describe("entryNameFromFile", () => {
  it("strips known extensions", () => {
    expect(entryNameFromFile(new File(["x"], "My Resume.pdf"))).toBe("My Resume");
    expect(entryNameFromFile(new File(["x"], "notes.md"))).toBe("notes");
  });

  it("keeps unknown extensions", () => {
    expect(entryNameFromFile(new File(["x"], "archive.tar"))).toBe("archive.tar");
  });
});

describe("entryNameFromUrl", () => {
  it("prefers the page title", () => {
    expect(entryNameFromUrl("https://osama.dev", "Osama — Portfolio")).toBe(
      "Osama — Portfolio"
    );
  });

  it("falls back to the hostname", () => {
    expect(entryNameFromUrl("https://osama.dev/projects", "")).toBe("osama.dev");
  });

  it("returns the raw input when it is not a URL", () => {
    expect(entryNameFromUrl("not a url", "")).toBe("not a url");
  });
});

describe("readEntryFile", () => {
  it("routes PDFs through extractPdfText", async () => {
    const file = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
    const entry = await readEntryFile(file);
    expect(extractPdfText).toHaveBeenCalledWith(file);
    expect(entry).toEqual({ name: "resume", content: "# Converted markdown" });
  });

  it("reads text files locally", async () => {
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    const entry = await readEntryFile(file);
    expect(entry).toEqual({ name: "notes", content: "hello world" });
  });
});
```

`src/lib/__tests__/fetchUrl.test.js`:

```js
import { describe, expect, it } from "vitest";
import { extractUrls, normalizeUrlInput } from "../fetchUrl.js";

describe("extractUrls", () => {
  it("finds urls and strips trailing punctuation", () => {
    expect(extractUrls("see https://osama.dev, ok")).toEqual(["https://osama.dev"]);
  });
});

describe("normalizeUrlInput", () => {
  it("returns the first url found in the text", () => {
    expect(normalizeUrlInput("my site: https://osama.dev/projects")).toBe(
      "https://osama.dev/projects"
    );
  });

  it("coerces a bare host to https", () => {
    expect(normalizeUrlInput("osama.dev")).toBe("https://osama.dev");
  });

  it("returns null for empty or unusable input", () => {
    expect(normalizeUrlInput("")).toBeNull();
    expect(normalizeUrlInput("   ")).toBeNull();
    expect(normalizeUrlInput("not a url at all")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/entryFile.test.js src/lib/__tests__/fetchUrl.test.js`
Expected: FAIL — unresolved `../entryFile.js` import; `normalizeUrlInput` not exported.

- [ ] **Step 3: Write minimal implementations**

`src/lib/entryFile.js`:

```js
// Shared file→entry intake for profile and custom context uploads.
// PDFs are converted server-side (Gemini); .md/.txt read locally.

import { extractPdfText } from "./extractPdf.js";

export function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export function entryNameFromFile(file) {
  return (file.name || "").replace(/\.(md|txt|pdf)$/i, "") || file.name;
}

/** Page title if present, else hostname, else the raw input. */
export function entryNameFromUrl(url, title) {
  const t = (title || "").trim();
  if (t) return t;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function readEntryFile(file) {
  const name = entryNameFromFile(file);
  if (isPdfFile(file)) {
    return { name, content: await extractPdfText(file) };
  }
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
  return { name, content };
}
```

Append to `src/lib/fetchUrl.js`:

```js
/** First URL in the text, else the trimmed input coerced to https://. Null if unusable. */
export function normalizeUrlInput(text) {
  const found = extractUrls(text)[0];
  if (found) return found;
  const trimmed = String(text || "").trim();
  if (!trimmed || /\s/.test(trimmed) || !trimmed.includes(".")) return null;
  const candidate = `https://${trimmed}`;
  try {
    // eslint-disable-next-line no-new
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/entryFile.test.js src/lib/__tests__/fetchUrl.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entryFile.js src/lib/fetchUrl.js src/lib/__tests__/entryFile.test.js src/lib/__tests__/fetchUrl.test.js
git commit -m "feat: shared entry-file intake helpers and URL normalization"
```

---

### Task 3: Server — `pdfToMarkdown` + `POST /api/extract-pdf`

**Files:**
- Modify: `server/gemini.js` (new export, after `scoreAudio`)
- Modify: `server/index.js` (new route, after the `/api/fetch-url` route ~line 90)

**Interfaces:**
- Consumes: existing `ai()`, `MODEL`, `isConfigured()` in `server/gemini.js`; existing `upload` multer instance in `server/index.js`.
- Produces: `POST /api/extract-pdf` (multipart, field `file`) → `200 { text }`, `400 { error }` (missing/non-PDF/oversized), `503 { error }` (no key), `500 { error }`.

- [ ] **Step 1: Add `pdfToMarkdown` to `server/gemini.js`** (after `scoreAudio`)

```js
/** PDF → clean markdown (resume/profile intake). Gemini reads PDFs natively. */
export async function pdfToMarkdown(pdfBase64) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Convert this document to clean markdown. Preserve headings, lists, and structure. " +
              "Output only the markdown — no commentary, no code fences.",
          },
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
        ],
      },
    ],
  });
  return res.text;
}
```

- [ ] **Step 2: Add the route to `server/index.js`** (after the `/api/fetch-url` route). Also add `pdfToMarkdown` to the import from `./gemini.js` on line 9.

```js
// PDF → markdown for profile/context intake (resumes). Small files only.
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB — Gemini inline limit is 20MB

app.post("/api/extract-pdf", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      if (!isConfigured()) {
        return res.status(503).json({
          error:
            "PDF conversion needs GEMINI_API_KEY in .env (see .env.example). Add it and restart with `npm run dev`.",
        });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Missing file." });
      const isPdf =
        file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
      if (!isPdf) return res.status(400).json({ error: "Only PDF files are supported here." });
      if (file.size > MAX_PDF_BYTES) {
        return res.status(400).json({ error: "PDF exceeds 10MB — export a smaller copy and retry." });
      }
      const text = await pdfToMarkdown(file.buffer.toString("base64"));
      res.json({ text });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});
```

- [ ] **Step 3: Verify end-to-end with curl** (server restart picks up the change; key is configured locally)

```bash
printf 'Osama Badr — Senior QA Analyst\n- Test strategy, risk scoring\n' > /tmp/iprep-test.txt
cupsfilter /tmp/iprep-test.txt > /tmp/iprep-test.pdf 2>/dev/null
curl -s -X POST -F "file=@/tmp/iprep-test.pdf;type=application/pdf" http://localhost:3001/api/extract-pdf
```

Expected: `{"text":"..."}` containing markdown with the resume line. Also verify the guards:

```bash
curl -s -X POST -F "file=@/tmp/iprep-test.txt;type=text/plain" http://localhost:3001/api/extract-pdf
```

Expected: `{"error":"Only PDF files are supported here."}` (400).

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/gemini.js server/index.js
git commit -m "feat: /api/extract-pdf converts PDFs to markdown via Gemini"
```

---

### Task 4: Onboarding Profile step UI (+ JobStep DRY refactor)

**Files:**
- Modify: `src/features/onboarding/Onboarding.jsx` — ProfileStep (`handleUpload` ~line 592, upload label ~line 672) and JobStep `handleFetch` (~line 728).

**Interfaces:**
- Consumes: `readEntryFile`, `entryNameFromUrl` (Task 2), `normalizeUrlInput` (Task 2), existing `fetchUrlContent`, `isProxyReachable`, `onAdd({ name, content })` prop.
- Produces: no new exports (UI only).

- [ ] **Step 1: Add imports** near line 20:

```js
import { extractUrls, fetchUrlContent, normalizeUrlInput } from "../../lib/fetchUrl.js";
import { readEntryFile, entryNameFromUrl } from "../../lib/entryFile.js";
```

(`extractUrls` stays only if still referenced after Step 4's refactor; drop it otherwise.)

- [ ] **Step 2: Rework ProfileStep upload.** Add state next to the existing `adding` state (~line 580):

```js
const [uploadBusy, setUploadBusy] = useState(false);
const [uploadError, setUploadError] = useState("");
const [portfolioUrl, setPortfolioUrl] = useState("");
const [portfolioBusy, setPortfolioBusy] = useState(false);
const [portfolioError, setPortfolioError] = useState("");
```

Replace `handleUpload` (lines 592-602):

```js
async function handleUpload(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  setUploadBusy(true);
  setUploadError("");
  try {
    onAdd(await readEntryFile(file));
  } catch (err) {
    setUploadError(err.message || "Could not read that file.");
  } finally {
    setUploadBusy(false);
  }
}
```

- [ ] **Step 3: Update the upload control and add the portfolio row.** Replace the upload `<label>` block (lines 672-680) with:

```jsx
<label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-600 py-3 text-sm text-slate-400 transition hover:border-ink-500 hover:text-white">
  {uploadBusy ? "Converting…" : "Upload .md / .txt / .pdf"}
  <input
    type="file"
    accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
    className="hidden"
    disabled={uploadBusy}
    onChange={handleUpload}
  />
</label>
```

Directly after the closing `</div>` of that flex row (after line 681's `</div>`, still inside the non-`adding` branch is fine — but the URL row should be visible in BOTH branches, so place it after the entire `adding ? … : …` block, before the footer `<div className="mt-6 …">`):

```jsx
<div className="mt-3 flex items-center gap-2">
  <input
    value={portfolioUrl}
    onChange={(e) => setPortfolioUrl(e.target.value)}
    placeholder="https://... portfolio or personal site"
    className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
  />
  <button
    onClick={handleFetchPortfolio}
    disabled={portfolioBusy}
    className="shrink-0 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-ink-500 disabled:opacity-50"
  >
    {portfolioBusy ? "Fetching…" : "Add from URL"}
  </button>
</div>
{(uploadError || portfolioError) && (
  <p className="mt-1 text-xs text-red-300">{uploadError || portfolioError}</p>
)}
```

With the handler beside `handleUpload`:

```js
async function handleFetchPortfolio() {
  const url = normalizeUrlInput(portfolioUrl);
  if (!url) {
    setPortfolioError("Enter a URL to fetch.");
    return;
  }
  setPortfolioBusy(true);
  setPortfolioError("");
  try {
    const proxyOk = await isProxyReachable();
    if (!proxyOk) {
      setPortfolioError("Proxy is offline (run npm run dev) — paste the content manually instead.");
      return;
    }
    const { title, text } = await fetchUrlContent(url);
    onAdd({ name: entryNameFromUrl(url, title), content: text });
    setPortfolioUrl("");
  } catch (e) {
    setPortfolioError(e.message || "Could not fetch that URL.");
  } finally {
    setPortfolioBusy(false);
  }
}
```

- [ ] **Step 4: DRY JobStep.** Replace the URL-derivation block in `handleFetch` (lines 728-750, the `let url = extractUrls(fetchUrl)[0]; …` section through the `if (!url) { setFetchError… }`) with:

```js
const url = normalizeUrlInput(fetchUrl);
if (!url) {
  setFetchError("Enter a URL to fetch.");
  return;
}
```

Remove the now-unused `extractUrls` import if nothing else references it.

- [ ] **Step 5: Run the full suite + manual check**

Run: `npx vitest run` — expected: all passing.
Manual: with the dev server running, open http://localhost:5175, wipe nothing — use "+ New job" → the profile step appears only on first-run onboarding, so instead verify via first-run in a private browser window (fresh storage): upload a PDF → entry appears named after the file; paste a URL → "Add from URL" → entry appears.

- [ ] **Step 6: Commit**

```bash
git add src/features/onboarding/Onboarding.jsx
git commit -m "feat: PDF upload and portfolio-URL intake in onboarding profile step"
```

---

### Task 5: Context tab UI

**Files:**
- Modify: `src/features/context/Context.jsx` — `handleUploadFile` (~line 95), upload label (~line 220), imports (top of file).

**Interfaces:**
- Consumes: `readEntryFile`, `entryNameFromUrl`, `normalizeUrlInput`, `fetchUrlContent`, `isProxyReachable` (from `../../lib/claude.js`), existing `addCustomContextEntry`, `onChange()`.
- Produces: no new exports (UI only).

- [ ] **Step 1: Add imports** at the top of `Context.jsx`:

```js
import { fetchUrlContent, normalizeUrlInput } from "../../lib/fetchUrl.js";
import { readEntryFile, entryNameFromUrl } from "../../lib/entryFile.js";
import { isProxyReachable } from "../../lib/claude.js";
```

- [ ] **Step 2: Add state + async upload.** Next to the existing `adding` state add:

```js
const [uploadBusy, setUploadBusy] = useState(false);
const [uploadError, setUploadError] = useState("");
const [sourceUrl, setSourceUrl] = useState("");
const [urlBusy, setUrlBusy] = useState(false);
const [urlError, setUrlError] = useState("");
```

Replace `handleUploadFile` (lines 95-106):

```js
async function handleUploadFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  setUploadBusy(true);
  setUploadError("");
  try {
    const entry = await readEntryFile(file);
    addCustomContextEntry(entry);
    onChange();
  } catch (err) {
    setUploadError(err.message || "Could not read that file.");
  } finally {
    setUploadBusy(false);
  }
}

async function handleAddFromUrl() {
  const url = normalizeUrlInput(sourceUrl);
  if (!url) {
    setUrlError("Enter a URL to fetch.");
    return;
  }
  setUrlBusy(true);
  setUrlError("");
  try {
    const proxyOk = await isProxyReachable();
    if (!proxyOk) {
      setUrlError("Proxy is offline (run npm run dev) — paste the content manually instead.");
      return;
    }
    const { title, text } = await fetchUrlContent(url);
    addCustomContextEntry({ name: entryNameFromUrl(url, title), content: text });
    setSourceUrl("");
    onChange();
  } catch (e) {
    setUrlError(e.message || "Could not fetch that URL.");
  } finally {
    setUrlBusy(false);
  }
}
```

- [ ] **Step 3: Update the upload control and add the URL row.** Replace the upload `<label>` (lines 220-228) with:

```jsx
<label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-600 py-3 text-sm text-slate-400 transition hover:border-ink-500 hover:text-white">
  {uploadBusy ? "Converting…" : "Upload .md / .txt / .pdf"}
  <input
    type="file"
    accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
    className="hidden"
    disabled={uploadBusy}
    onChange={handleUploadFile}
  />
</label>
```

After the entire `adding ? … : …` block (still inside the Custom `<section>`, before `</section>`):

```jsx
<div className="mt-3 flex items-center gap-2">
  <input
    value={sourceUrl}
    onChange={(e) => setSourceUrl(e.target.value)}
    placeholder="https://... page to pull in (portfolio, docs, posting)"
    className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
  />
  <button
    onClick={handleAddFromUrl}
    disabled={urlBusy}
    className="shrink-0 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-ink-500 disabled:opacity-50"
  >
    {urlBusy ? "Fetching…" : "Add from URL"}
  </button>
</div>
{(uploadError || urlError) && (
  <p className="mt-1 text-xs text-red-300">{uploadError || urlError}</p>
)}
```

Also update the intro copy at line 29 (`notes, or upload a file`) to mention PDFs: `notes, upload a file (.md/.txt/.pdf), or pull in a page by URL`.

- [ ] **Step 4: Run the full suite + manual check**

Run: `npx vitest run` — expected: all passing.
Manual: Context tab → upload a PDF → "Converting…" → entry appears; "Add from URL" with a real site → entry appears with page title as the name.

- [ ] **Step 5: Commit**

```bash
git add src/features/context/Context.jsx
git commit -m "feat: PDF upload and add-from-URL in the context tab"
```

---

### Task 6: Verification + PR

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all tests pass (93 pre-existing + new lib tests).

- [ ] **Step 2: Browser verification** — drive the running app (port 5175): Context tab PDF upload (real converted output visible in the entry editor), Add from URL against a real public page, and the error path (rename a `.txt` to `.pdf` → server 500/Gemini error surfaces inline; or stop the proxy → proxy-offline message).

- [ ] **Step 3: Confirm no secrets staged**

Run: `git status --short` — `.env` must NOT appear (gitignored); `qa-agent.config.json` and `.claude/` stay untracked.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin pdf-portfolio-intake
gh pr create --title "PDF resume upload + portfolio link intake" --body "…covering: what/why, spec link, test plan, QA-agent run"
```

- [ ] **Step 5: Run the QA agent on the PR** (same invocation as PRs #2–#6; key from BIP/.env.local, authorized).
