import { useState, useEffect } from "react";
import PrepDocs from "./features/prep-docs/PrepDocs.jsx";
import Flashcards from "./features/flashcards/Flashcards.jsx";
import Audio from "./features/audio/Audio.jsx";
import Advisor from "./features/advisor/Advisor.jsx";
import Context from "./features/context/Context.jsx";
import Onboarding from "./features/onboarding/Onboarding.jsx";
import JobSwitcher from "./components/JobSwitcher.jsx";
import ManageJobsModal from "./components/ManageJobsModal.jsx";
import { APP } from "../interview.config.js";
import { getContextSummary } from "./lib/context.js";
import { getMode, setMode, MODE_PASTE, MODE_API } from "./lib/coach.js";
import { getActiveJobId, getJobs } from "./lib/jobs.js";
import { onQuotaError } from "./lib/storage.js";

const TABS = [
  { id: "prep", label: "Prep Docs", sub: "Stage-by-stage" },
  { id: "cards", label: "Flashcards", sub: "Behavioral / situational" },
  { id: "audio", label: "Audio", sub: "Record · transcribe · score" },
  { id: "advisor", label: "Advisor", sub: "Chat · readiness · flashcards" },
  { id: "context", label: "Context", sub: "Sources · toggles · custom notes" },
];

export default function App() {
  const [needsOnboarding, setNeedsOnboarding] = useState(() => getJobs().length === 0);
  const [ctx, setCtx] = useState(getContextSummary());
  const [mode, setModeState] = useState(getMode());
  const [tab, setTab] = useState("prep");
  const [activeJobId, setActiveJobIdState] = useState(getActiveJobId());
  const [manageOpen, setManageOpen] = useState(false);
  const [addingJob, setAddingJob] = useState(false);
  const [quotaWarning, setQuotaWarning] = useState(false);

  useEffect(() => {
    onQuotaError(() => setQuotaWarning(true));
    return () => onQuotaError(null);
  }, []);

  function refreshCtx() {
    setCtx(getContextSummary());
  }

  function handleJobChange(id) {
    setActiveJobIdState(id ?? getActiveJobId());
    refreshCtx();
  }

  function toggleMode() {
    const next = mode === MODE_PASTE ? MODE_API : MODE_PASTE;
    setMode(next);
    setModeState(next);
  }

  if (needsOnboarding) {
    return (
      <Onboarding
        mode="firstRun"
        onComplete={(jobId) => {
          handleJobChange(jobId);
          setNeedsOnboarding(false);
        }}
      />
    );
  }

  // addingJob replaces the mounted app entirely (same shape as needsOnboarding
  // above) rather than overlaying it — the old <main> stayed mounted underneath
  // and the Generate step's setActiveJobId mid-wizard let unguarded async
  // continuations in old-job components (e.g. InterviewRecording) write under
  // the new job. The overlay was visually opaque anyway, so this changes
  // nothing the user could see.
  if (addingJob) {
    return (
      <Onboarding
        mode="addJob"
        onComplete={(id) => {
          handleJobChange(id);
          setAddingJob(false);
        }}
        onCancel={() => setAddingJob(false)}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-700 bg-ink-900/80 px-6 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-5">
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500 text-sm font-extrabold text-white">
              IP
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-white">
                {APP.title}
              </h1>
              <p className="text-xs text-slate-400">{APP.subtitle}</p>
            </div>
          </div>

          <JobSwitcher
            onJobChange={handleJobChange}
            onManageJobs={() => setManageOpen(true)}
            onNewJob={() => setAddingJob(true)}
          />

          <nav className="flex shrink-0 items-center gap-1 rounded-lg bg-ink-800 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={t.sub}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  tab === t.id
                    ? "bg-accent-500 text-white"
                    : "text-slate-300 hover:bg-ink-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <span
            title={ctx.names.join(", ")}
            className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {ctx.count} context sources active
          </span>
          <ModeToggle mode={mode} onToggle={toggleMode} />
        </div>
      </header>

      {quotaWarning && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
          <span>
            Browser storage is full — your latest change may not have saved. Export
            your jobs from Manage jobs, then clear old data.
          </span>
          <button
            onClick={() => setQuotaWarning(false)}
            className="shrink-0 rounded px-1.5 py-0.5 text-amber-200/80 hover:bg-amber-500/20 hover:text-amber-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <main key={activeJobId} className="min-h-0 flex-1">
        {tab === "prep" && <PrepDocs />}
        {tab === "cards" && <Flashcards />}
        {tab === "audio" && <Audio />}
        {tab === "advisor" && <Advisor onContextChange={refreshCtx} />}
        {tab === "context" && <Context onChange={refreshCtx} />}
      </main>

      <ManageJobsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onJobChange={handleJobChange}
      />
    </div>
  );
}

function ModeToggle({ mode, onToggle }) {
  const isApi = mode === MODE_API;
  return (
    <button
      onClick={onToggle}
      title={
        isApi
          ? "API mode — automated coaching via local proxy (npm run dev + .env keys)"
          : "Paste mode — copy prompts to an external chat when the proxy is off (no API key)"
      }
      className="flex items-center gap-2 rounded-full border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-ink-500"
    >
      <span
        className={`h-2 w-2 rounded-full ${isApi ? "bg-amber-400" : "bg-accent-400"}`}
      />
      AI: {isApi ? "API" : "Paste"} mode
    </button>
  );
}
