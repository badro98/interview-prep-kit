import { useEffect, useRef, useState } from "react";
import { APP, STAGE_PRESETS, ADVISOR_STARTERS, STAGES } from "../../../interview.config.js";
import {
  getProfileName,
  setProfileName,
  getProfileEntries,
  addProfileEntry,
  removeProfileEntry,
} from "../../lib/profile.js";
import { createJob, setActiveJobId, importJob } from "../../lib/jobs.js";
import { addCustomContextEntry, addCustomCards } from "../../lib/store.js";
import {
  generateStageDoc,
  saveStageDoc,
  generateFlashcards,
  parseFlashcards,
  buildFlashcardsTask,
} from "../../lib/generate.js";
import { getMode, MODE_API, buildPrompt } from "../../lib/coach.js";
import { fetchUrlContent, normalizeUrlInput } from "../../lib/fetchUrl.js";
import { readEntryFile, entryNameFromUrl } from "../../lib/entryFile.js";
import { isProxyReachable } from "../../lib/claude.js";
import { cloneStagePresets } from "./steps.js";
import StageEditor from "../../components/StageEditor.jsx";

const HAS_SAMPLE_SETUP = STAGES.some((s) => s.file);

const STEP_ORDER = ["welcome", "profile", "job", "stages", "attach", "generate"];

/**
 * First-run / add-job onboarding wizard. `firstRun` starts at Welcome and has
 * no Cancel; `addJob` starts at Job (profile already exists) and shows Cancel.
 */
export default function Onboarding({ mode = "firstRun", onComplete, onCancel }) {
  const isAddJob = mode === "addJob";
  const steps = isAddJob ? STEP_ORDER.filter((s) => s !== "welcome" && s !== "profile") : STEP_ORDER;

  const [stepIdx, setStepIdx] = useState(0);
  const step = steps[stepIdx];

  const [name, setName] = useState(() => getProfileName());
  const [profileEntries, setProfileEntries] = useState(() => getProfileEntries());
  const [skippedProfile, setSkippedProfile] = useState(false);

  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [jd, setJd] = useState("");

  const [stages, setStages] = useState(() => cloneStagePresets(STAGE_PRESETS));

  const [attached, setAttached] = useState(() => new Set(profileEntries.map((e) => e.id)));

  const [importError, setImportError] = useState("");

  // The job doesn't exist until the Generate step activates it. A ref (not just
  // state) guards creation against React StrictMode's double-invoked effects,
  // since state updates aren't visible to a synchronously-repeated effect call.
  const [job, setJob] = useState(null);
  const jobRef = useRef(null);
  // Guards runAllRows against StrictMode's double-invoked mount effect (same
  // synchronous-ref pattern as jobRef/rowsRef): without this, two concurrent
  // sequential generation passes fire, duplicating API calls and flashcards.
  const startedRef = useRef(false);

  function goNext() {
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    // Once the job exists (Generate step created it), backing out of Generate
    // would silently drop any edits made after re-entering Stages/Job — refs
    // guarding job/row creation return the stale job. No-op instead of
    // pretending edits still apply. Defensive: keyboard/step-indicator paths
    // could reach here even though the Back button is no longer rendered.
    if (steps[stepIdx] === "generate" && jobRef.current) return;
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  // ---- Welcome -----------------------------------------------------------

  function handleContinueFromWelcome() {
    setProfileName(name.trim() || getProfileName());
    goNext();
  }

  function handleUseSampleSetup() {
    setProfileName(name.trim() || getProfileName());
    const created = createJob({
      role: APP.role,
      company: APP.company,
      stages: STAGES,
      advisorStarters: ADVISOR_STARTERS,
    });
    setActiveJobId(created.id);
    onComplete?.(created.id);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setImportError("Invalid job export file");
        return;
      }
      try {
        setProfileName(name.trim() || getProfileName());
        const imported = importJob(parsed);
        setActiveJobId(imported.id);
        onComplete?.(imported.id);
      } catch (err) {
        setImportError(err.message || "Invalid job export file");
      }
    };
    reader.onerror = () => setImportError("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  // ---- Profile -------------------------------------------------------------

  function refreshProfileEntries() {
    const entries = getProfileEntries();
    setProfileEntries(entries);
    setAttached((prev) => {
      const next = new Set(prev);
      for (const entry of entries) if (!prev.has(entry.id)) next.add(entry.id);
      return next;
    });
    return entries;
  }

  function handleProfileNext() {
    // Back → add entries → Next should un-stick a prior Skip so Attach isn't
    // bypassed for a profile that now has entries.
    setSkippedProfile(getProfileEntries().length === 0);
    goNext();
  }

  function handleSkipProfile() {
    setSkippedProfile(true);
    goNext();
  }

  // ---- Job ------------------------------------------------------------------

  const jobValid = role.trim() && company.trim();

  function handleReplaceJd(nextText) {
    if (jd.trim() && jd.trim() !== nextText.trim()) {
      if (!window.confirm("Replace the current job description text with the fetched content?")) {
        return;
      }
    }
    setJd(nextText);
  }

  // ---- Attach -------------------------------------------------------------

  function toggleAttach(id) {
    setAttached((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- navigation across the optional Profile/Attach coupling -------------

  function handleAdvance(fromStep) {
    if (fromStep === "job") {
      goNext();
      return;
    }
    if (fromStep === "stages") {
      const hasEntries = getProfileEntries().length > 0;
      if (!hasEntries || skippedProfile) {
        // Jump straight past Attach to Generate.
        const genIdx = steps.indexOf("generate");
        setStepIdx(genIdx !== -1 ? genIdx : Math.min(stepIdx + 1, steps.length - 1));
        return;
      }
      goNext();
      return;
    }
    goNext();
  }

  // ---- Generate -----------------------------------------------------------

  const [rows, setRows] = useState(null); // built lazily on entering Generate
  const rowsRef = useRef(null);
  const [aiMode] = useState(() => getMode());

  function ensureJobCreated() {
    if (jobRef.current) return jobRef.current;
    // Filter against current profile entries — an entry attached earlier in
    // the wizard may have since been removed (e.g. via Back → remove entry).
    const currentEntryIds = new Set(getProfileEntries().map((e) => e.id));
    const profileRefs = [...attached].filter((id) => currentEntryIds.has(id));
    const created = createJob({
      role: role.trim(),
      company: company.trim(),
      stages,
      advisorStarters: ADVISOR_STARTERS,
      profileRefs,
    });
    setActiveJobId(created.id);
    if (jd.trim()) {
      addCustomContextEntry({ name: "Job description", content: jd });
    }
    jobRef.current = created;
    setJob(created);
    return created;
  }

  function ensureRowsBuilt(activeJob) {
    if (rowsRef.current) return rowsRef.current;
    // Prompt is built eagerly for every row (not just paste mode) so an
    // API-mode row that errors (e.g. proxy unreachable) can still offer the
    // "Copy prompt" paste fallback immediately — buildPrompt() is pure
    // assembly, no network call.
    const built = [
      ...activeJob.stages.map((s) => ({
        kind: "stage",
        id: s.id,
        stage: s,
        label: s.title,
        status: "pending",
        error: null,
        prompt: buildPrompt({ task: s.regenTask }),
        paste: "",
      })),
      {
        kind: "flashcards",
        id: "__flashcards__",
        label: "Flashcards",
        status: "pending",
        error: null,
        prompt: buildPrompt({ task: buildFlashcardsTask(activeJob) }),
        paste: "",
        count: null,
      },
    ];
    rowsRef.current = built;
    setRows(built);
    return built;
  }

  function updateRow(id, patch) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      rowsRef.current = next;
      return next;
    });
  }

  async function runStageRow(row) {
    updateRow(row.id, { status: "running", error: null });
    try {
      const result = await generateStageDoc(row.stage);
      if (result.mode === "api") {
        saveStageDoc(row.stage.id, result.text);
        updateRow(row.id, { status: "done" });
      } else {
        updateRow(row.id, { status: "paste-ready", prompt: result.prompt });
      }
    } catch (e) {
      updateRow(row.id, { status: "error", error: e.message || "Generation failed." });
    }
  }

  async function runFlashcardsRow(row, activeJob) {
    updateRow(row.id, { status: "running", error: null });
    try {
      const result = await generateFlashcards(activeJob);
      if (result.mode === "api") {
        const added = addCustomCards(result.cards);
        updateRow(row.id, { status: "done", count: added });
      } else {
        updateRow(row.id, { status: "paste-ready", prompt: result.prompt });
      }
    } catch (e) {
      updateRow(row.id, { status: "error", error: e.message || "Generation failed." });
    }
  }

  async function runAllRows(builtRows, activeJob) {
    for (const row of builtRows) {
      if (row.kind === "stage") {
        // eslint-disable-next-line no-await-in-loop
        await runStageRow(row);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await runFlashcardsRow(row, activeJob);
      }
    }
  }

  function handleEnterGenerate() {
    const activeJob = ensureJobCreated();
    const built = ensureRowsBuilt(activeJob);
    // API mode: each row calls coach() and lands done/error. Paste mode: coach()
    // just assembles the prompt (no network call), landing rows "paste-ready"
    // so every "Copy prompt" button works immediately instead of staying disabled.
    if (startedRef.current) return;
    startedRef.current = true;
    runAllRows(built, activeJob);
  }

  function retryRow(row) {
    const activeJob = jobRef.current;
    if (row.kind === "stage") runStageRow(row);
    else runFlashcardsRow(row, activeJob);
  }

  function skipRow(row) {
    updateRow(row.id, { status: "skipped", error: null });
  }

  function savePasteReply(row) {
    if (row.kind === "stage") {
      if (!row.paste.trim()) return;
      saveStageDoc(row.stage.id, row.paste.trim());
      updateRow(row.id, { status: "done", error: null });
      return;
    }
    try {
      const { cards } = parseFlashcards(row.paste);
      const added = addCustomCards(cards);
      updateRow(row.id, { status: "done", count: added, error: null });
    } catch (e) {
      updateRow(row.id, { error: e.message || "Could not parse flashcards" });
    }
  }

  async function copyPrompt(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand?.("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
      return true;
    }
  }

  function handleSkipGeneration() {
    const activeJob = ensureJobCreated();
    onComplete?.(activeJob.id);
  }

  const allRowsSettled = rows
    ? rows.every((r) => ["done", "error", "skipped"].includes(r.status))
    : false;
  const anyRunning = rows ? rows.some((r) => r.status === "running") : false;

  function handleFinish() {
    onComplete?.(jobRef.current.id);
  }

  // ---- render -------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-900 text-slate-200">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-xl">
          <Header stepIdx={stepIdx} totalSteps={steps.length} />

          <div className="mt-6 rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl">
            <div className="px-6 py-6">
              {step === "welcome" && (
                <WelcomeStep
                  name={name}
                  onNameChange={setName}
                  onContinue={handleContinueFromWelcome}
                  showSampleSetup={HAS_SAMPLE_SETUP}
                  onUseSampleSetup={handleUseSampleSetup}
                  onImportFile={handleImportFile}
                  importError={importError}
                />
              )}

              {step === "profile" && (
                <ProfileStep
                  entries={profileEntries}
                  onAdd={(entry) => {
                    addProfileEntry(entry);
                    refreshProfileEntries();
                  }}
                  onRemove={(id) => {
                    removeProfileEntry(id);
                    refreshProfileEntries();
                  }}
                  onBack={goBack}
                  onSkip={handleSkipProfile}
                  onNext={handleProfileNext}
                />
              )}

              {step === "job" && (
                <JobStep
                  role={role}
                  company={company}
                  jd={jd}
                  onRoleChange={setRole}
                  onCompanyChange={setCompany}
                  onJdChange={setJd}
                  onReplaceJd={handleReplaceJd}
                  onBack={isAddJob ? null : goBack}
                  onNext={() => handleAdvance("job")}
                  valid={jobValid}
                />
              )}

              {step === "stages" && (
                <StagesStep
                  stages={stages}
                  onChange={setStages}
                  onBack={goBack}
                  onNext={() => handleAdvance("stages")}
                />
              )}

              {step === "attach" && (
                <AttachStep
                  entries={profileEntries}
                  attached={attached}
                  onToggle={toggleAttach}
                  onBack={goBack}
                  onNext={goNext}
                />
              )}

              {step === "generate" && (
                <GenerateStep
                  rows={rows}
                  aiMode={aiMode}
                  onEnter={handleEnterGenerate}
                  onRetry={retryRow}
                  onSkipRow={skipRow}
                  onPasteChange={(id, val) => updateRow(id, { paste: val })}
                  onSavePaste={savePasteReply}
                  onCopyPrompt={copyPrompt}
                  onSkipGeneration={handleSkipGeneration}
                  onFinish={handleFinish}
                  canFinish={rows ? !anyRunning : false}
                  allSettled={allRowsSettled}
                />
              )}
            </div>
          </div>

          {isAddJob && onCancel && step !== "generate" && (
            <div className="mt-4 text-center">
              <button
                onClick={onCancel}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ stepIdx, totalSteps }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500 text-sm font-extrabold text-white">
        IP
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Step {stepIdx + 1} of {totalSteps}
      </p>
    </div>
  );
}

function StepFooter({ onBack, onNext, nextDisabled, nextLabel = "Next" }) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {onBack ? (
        <button
          onClick={onBack}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-ink-700 hover:text-white"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ---- Welcome ----------------------------------------------------------------

function WelcomeStep({
  name,
  onNameChange,
  onContinue,
  showSampleSetup,
  onUseSampleSetup,
  onImportFile,
  importError,
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">Welcome to Interview Prep</h2>
      <p className="mt-2 text-sm text-slate-400">
        A local-first study tool for interview loops — prep docs, flashcards, audio
        practice, and an advisor, all grounded in your real background.
      </p>

      <label className="mt-6 block text-xs font-medium text-slate-400">Your name</label>
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Your name"
        className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
      />

      <StepFooter onBack={null} onNext={onContinue} nextLabel="Get started" />

      <div className="mt-6 space-y-2 border-t border-ink-700 pt-5">
        {showSampleSetup && (
          <button
            onClick={onUseSampleSetup}
            className="w-full rounded-lg border border-dashed border-ink-600 py-2.5 text-xs text-slate-400 transition hover:border-ink-500 hover:text-white"
          >
            Use the repo's sample setup
          </button>
        )}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 py-2.5 text-xs text-slate-400 transition hover:border-ink-500 hover:text-white">
          Import a job export (.json)
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onImportFile}
          />
        </label>
        {importError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {importError}
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Profile ------------------------------------------------------------------

function ProfileStep({ entries, onAdd, onRemove, onBack, onSkip, onNext }) {
  const [adding, setAdding] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [content, setContent] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");

  function handleAdd() {
    if (!entryName.trim() || !content.trim()) return;
    onAdd({ name: entryName, content });
    setEntryName("");
    setContent("");
    setAdding(false);
  }

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

  return (
    <div>
      <h2 className="text-lg font-semibold text-white">Your profile</h2>
      <p className="mt-2 text-sm text-slate-400">
        Optional — add your resume, stories, or portfolio once. It's shared across every
        job you set up, so you attach relevant pieces per job instead of re-pasting them.
      </p>

      <div className="mt-4 space-y-1 rounded-xl border border-ink-700 bg-ink-900/40 p-2">
        {entries.length === 0 && !adding && (
          <p className="px-2 py-3 text-sm text-slate-500">No profile entries yet.</p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-ink-700/50"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
              {entry.name}
            </span>
            <button
              onClick={() => onRemove(entry.id)}
              className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-ink-600 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-xl border border-ink-600 bg-ink-900 p-4">
          <input
            value={entryName}
            onChange={(e) => setEntryName(e.target.value)}
            placeholder="Title (e.g. Resume, Portfolio, Stories)"
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Paste content…"
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-800 p-3 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setAdding(false)}
              className="text-sm text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => setAdding(true)}
            className="flex-1 rounded-xl border border-dashed border-ink-600 py-3 text-sm text-slate-400 transition hover:border-ink-500 hover:text-white"
          >
            + Paste profile entry
          </button>
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
        </div>
      )}

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

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-ink-700 hover:text-white"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-400"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Job ----------------------------------------------------------------------

function JobStep({
  role,
  company,
  jd,
  onRoleChange,
  onCompanyChange,
  onJdChange,
  onReplaceJd,
  onBack,
  onNext,
  valid,
}) {
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  async function handleFetch() {
    const url = normalizeUrlInput(fetchUrl);
    if (!url) {
      setFetchError("Enter a URL to fetch.");
      return;
    }
    setFetching(true);
    setFetchError("");
    try {
      const proxyOk = await isProxyReachable();
      if (!proxyOk) {
        setFetchError("Proxy is offline (run npm run dev) — paste the job description manually instead.");
        return;
      }
      const { text } = await fetchUrlContent(url);
      onReplaceJd(text);
    } catch (e) {
      setFetchError(e.message || "Could not fetch that URL — paste the job description manually instead.");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white">This job</h2>
      <p className="mt-2 text-sm text-slate-400">Role and company are required.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-400">Role</label>
          <input
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            placeholder="e.g. Senior QA Engineer"
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Company</label>
          <input
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
          />
        </div>
      </div>

      <label className="mt-4 block text-xs font-medium text-slate-400">
        Job description (optional)
      </label>
      <textarea
        value={jd}
        onChange={(e) => onJdChange(e.target.value)}
        rows={6}
        placeholder="Paste the job description…"
        className="mt-1 w-full resize-none rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm text-slate-200 focus:border-accent-500 focus:outline-none"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          value={fetchUrl}
          onChange={(e) => setFetchUrl(e.target.value)}
          placeholder="https://... job posting URL"
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
        />
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="shrink-0 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-ink-500 disabled:opacity-50"
        >
          {fetching ? "Fetching…" : "Fetch from URL"}
        </button>
      </div>
      {fetchError && <p className="mt-1 text-xs text-red-300">{fetchError}</p>}

      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={!valid} />
    </div>
  );
}

// ---- Stages ---------------------------------------------------------------

function StagesStep({ stages, onChange, onBack, onNext }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">Interview stages</h2>
      <p className="mt-2 text-sm text-slate-400">
        Rename, reorder, or remove stages. At least one is required.
      </p>

      <div className="mt-4">
        <StageEditor stages={stages} onChange={onChange} />
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={stages.length === 0} />
    </div>
  );
}

// ---- Attach -------------------------------------------------------------

function AttachStep({ entries, attached, onToggle, onBack, onNext }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">Attach profile to this job</h2>
      <p className="mt-2 text-sm text-slate-400">
        Choose which profile entries ground prep docs, flashcards, and the advisor for
        this job. You can change this later per job.
      </p>

      <div className="mt-4 space-y-1 rounded-xl border border-ink-700 bg-ink-900/40 p-2">
        {entries.map((entry) => (
          <label
            key={entry.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-700/50"
          >
            <input
              type="checkbox"
              checked={attached.has(entry.id)}
              onChange={() => onToggle(entry.id)}
              className="accent-indigo-500"
            />
            <span className="text-sm text-slate-200">{entry.name}</span>
          </label>
        ))}
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next" />
    </div>
  );
}

// ---- Generate -----------------------------------------------------------

function GenerateStep({
  rows,
  aiMode,
  onEnter,
  onRetry,
  onSkipRow,
  onPasteChange,
  onSavePaste,
  onCopyPrompt,
  onSkipGeneration,
  onFinish,
  canFinish,
  allSettled,
}) {
  useEffect(() => {
    onEnter();
    // Runs exactly once, when the Generate step first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-white">Generate your prep</h2>
      <p className="mt-2 text-sm text-slate-400">
        {aiMode === MODE_API
          ? "Generating a prep doc per stage and a flashcard deck through the local proxy."
          : "Copy each prompt into your AI chat of choice, then paste the reply back."}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Job created — you can edit details and regenerate any doc from the app later.
      </p>

      <div className="mt-4 space-y-2">
        {(rows || []).map((row) => (
          <GenerateRow
            key={row.id}
            row={row}
            aiMode={aiMode}
            onRetry={() => onRetry(row)}
            onSkip={() => onSkipRow(row)}
            onPasteChange={(val) => onPasteChange(row.id, val)}
            onSavePaste={() => onSavePaste(row)}
            onCopyPrompt={() => onCopyPrompt(row.prompt)}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onSkipGeneration}
          className="text-xs font-medium text-slate-500 hover:text-slate-300"
        >
          Skip generation
        </button>
        <button
          onClick={onFinish}
          disabled={!canFinish}
          title={
            canFinish
              ? undefined
              : "Wait for generation to finish, or skip/retry the running row"
          }
          className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Finish
        </button>
      </div>
      {allSettled && (
        <p className="mt-2 text-right text-xs text-emerald-400">All rows complete.</p>
      )}
    </div>
  );
}

function statusBadge(status) {
  switch (status) {
    case "pending":
      return { label: "Pending", cls: "bg-slate-500/15 text-slate-400" };
    case "running":
      return { label: "Generating…", cls: "bg-accent-500/15 text-accent-400" };
    case "done":
      return { label: "Done", cls: "bg-emerald-500/15 text-emerald-300" };
    case "error":
      return { label: "Error", cls: "bg-red-500/15 text-red-300" };
    case "skipped":
      return { label: "Skipped", cls: "bg-slate-500/15 text-slate-500" };
    case "paste-ready":
      return { label: "Awaiting paste", cls: "bg-amber-500/15 text-amber-300" };
    default:
      return { label: status, cls: "bg-slate-500/15 text-slate-400" };
  }
}

function GenerateRow({ row, aiMode, onRetry, onSkip, onPasteChange, onSavePaste, onCopyPrompt }) {
  const badge = statusBadge(row.status);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await onCopyPrompt();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
          {row.label}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        {row.status === "error" && (
          <button
            onClick={onRetry}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent-400 hover:bg-ink-700"
          >
            Retry
          </button>
        )}
        {row.status !== "done" && row.status !== "skipped" && (
          <button
            onClick={onSkip}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-ink-700 hover:text-white"
          >
            Skip
          </button>
        )}
      </div>

      {row.error && <p className="mt-1.5 text-xs text-red-300">{row.error}</p>}

      {aiMode === MODE_API && row.status === "error" && (
        <p className="mt-1.5 text-xs text-slate-500">
          Proxy unreachable? Copy the prompt into any AI chat and paste the reply back.
        </p>
      )}

      {row.status !== "done" && row.status !== "skipped" &&
        (aiMode !== MODE_API || row.status === "error") && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Paste-mode fallback</span>
            <button
              onClick={handleCopy}
              disabled={!row.prompt}
              className="rounded-md bg-accent-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "Copied ✓" : "Copy prompt"}
            </button>
          </div>
          <textarea
            value={row.paste}
            onChange={(e) => onPasteChange(e.target.value)}
            placeholder="Paste the model's reply here…"
            rows={3}
            className="w-full resize-none rounded-md border border-ink-600 bg-ink-900 p-2 font-mono text-xs leading-relaxed text-slate-200 focus:border-accent-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              onClick={onSavePaste}
              disabled={!row.paste?.trim()}
              className="rounded-md bg-ink-700 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
