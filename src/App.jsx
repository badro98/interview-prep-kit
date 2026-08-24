import { useState, useEffect } from "react";
import PrepDocs from "./features/prep-docs/PrepDocs.jsx";
import Flashcards from "./features/flashcards/Flashcards.jsx";
import Advisor from "./features/advisor/Advisor.jsx";
import Context from "./features/context/Context.jsx";
import Onboarding from "./features/onboarding/Onboarding.jsx";
import JobSwitcher from "./components/JobSwitcher.jsx";
import ManageJobsModal from "./components/ManageJobsModal.jsx";
import JobSettingsModal from "./components/JobSettingsModal.jsx";
import { APP } from "../interview.config.js";
import { getContextSummary, copySeedContextToJob } from "./lib/context.js";
import { getMode, setMode, MODE_PASTE, MODE_API } from "./lib/coach.js";
import { getActiveJobId, getJobs } from "./lib/jobs.js";
import { onQuotaError } from "./lib/storage.js";
import { getTheme, setTheme, THEME_DARK, THEME_LIGHT } from "./lib/theme.js";

const TABS = [
  { id: "prep", label: "Prep Docs", sub: "Stage-by-stage" },
  { id: "cards", label: "Flashcards", sub: "Practice · record · score" },
  { id: "advisor", label: "Advisor", sub: "Chat · readiness · flashcards" },
  { id: "context", label: "Context", sub: "Sources · toggles · custom notes" },
];

export default function App() {
  const [needsOnboarding, setNeedsOnboarding] = useState(() => getJobs().length === 0);
  const [ctx, setCtx] = useState(getContextSummary());
  const [mode, setModeState] = useState(getMode());
  const [theme, setThemeState] = useState(getTheme);
  const [tab, setTab] = useState("prep");
  const [activeJobId, setActiveJobIdState] = useState(getActiveJobId());
  // Bumped on every handleJobChange call so <main> remounts even when the
  // edited job is already active (e.g. Job Settings saving stage changes for
  // the active job) — activeJobId alone wouldn't change in that case, and
  // React bails out of a setState with an unchanged primitive, so the keyed
  // remount below needs a value that always changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    const nextId = id ?? getActiveJobId();
    if (nextId) copySeedContextToJob(nextId);
    setActiveJobIdState(nextId);
    refreshCtx();
  }

  // Settings can change the ACTIVE job in place (same id, so the key above
  // wouldn't change) — bump refreshKey only here so the tabs remount with the
  // edited stages. Other handleJobChange callers keep no-op-on-same-id semantics.
  function handleJobEdited(id) {
    setRefreshKey((k) => k + 1);
    handleJobChange(id);
  }

  function toggleMode() {
    const next = mode === MODE_PASTE ? MODE_API : MODE_PASTE;
    setMode(next);
    setModeState(next);
  }

  function toggleTheme() {
    const next = theme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    setTheme(next);
    setThemeState(next);
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
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 shadow-sm backdrop-blur sm:gap-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <div className="flex shrink-0 items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-extrabold text-white"
              title={`${APP.title}${APP.subtitle ? ` — ${APP.subtitle}` : ""}`}
            >
              IP
            </div>
            {/* Title/subtitle compete with the job pill + tabs — show only when wide. */}
            <div className="hidden leading-tight xl:block">
              <h1 className="text-sm font-semibold text-ink1">
                {APP.title}
              </h1>
              <p className="text-xs text-ink2">{APP.subtitle}</p>
            </div>
          </div>

          <JobSwitcher
            onJobChange={handleJobChange}
            onManageJobs={() => setManageOpen(true)}
            onNewJob={() => setAddingJob(true)}
            onJobSettings={() => setSettingsOpen(true)}
          />

          <nav className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface2 p-1 sm:gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={t.sub}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  tab === t.id
                    ? "bg-accent text-white"
                    : "text-ink1 hover:bg-surface"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span
            title={ctx.names.join(", ")}
            className="hidden items-center gap-1.5 text-xs text-ink2 xl:flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            {ctx.count} sources
          </span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <ModeToggle mode={mode} onToggle={toggleMode} />
        </div>
      </header>

      {quotaWarning && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span>
            Browser storage is full — your latest change may not have saved. Export
            your jobs from Manage jobs, then clear old data.
          </span>
          <button
            onClick={() => setQuotaWarning(false)}
            className="shrink-0 rounded px-1.5 py-0.5 text-amber-700/80 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-200/80 dark:hover:text-amber-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Keep tabs mounted so in-flight work (advisor replies, recordings, drafts)
            survives switching away and back. Remount per-job (and prep/cards
            on stage edits) via keys — not by unmounting on tab change. */}
        <TabPanel active={tab === "prep"}>
          <PrepDocs key={`prep:${activeJobId}:${refreshKey}`} />
        </TabPanel>
        <TabPanel active={tab === "cards"}>
          <Flashcards key={`cards:${activeJobId}:${refreshKey}`} />
        </TabPanel>
        <TabPanel active={tab === "advisor"}>
          <Advisor
            key={`advisor:${activeJobId}`}
            onContextChange={refreshCtx}
            onStagesChange={() => handleJobEdited(getActiveJobId())}
          />
        </TabPanel>
        <TabPanel active={tab === "context"}>
          <Context key={`context:${activeJobId}`} onChange={refreshCtx} />
        </TabPanel>
      </main>

      <ManageJobsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onJobChange={handleJobChange}
      />

      <JobSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(id) => {
          setSettingsOpen(false);
          handleJobEdited(id);
        }}
        onGoToContext={() => {
          setSettingsOpen(false);
          setTab("context");
        }}
      />
    </div>
  );
}

function TabPanel({ active, children }) {
  return (
    <div
      className={
        active
          ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
          : "hidden"
      }
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === THEME_DARK;
  return (
    <button
      onClick={onToggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink2 transition hover:border-accent/40 hover:text-ink1"
    >
      {isDark ? (
        <SunIcon />
      ) : (
        <MoonIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
    </svg>
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
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink1 transition hover:border-accent/40"
    >
      <span
        className={`h-2 w-2 rounded-full ${isApi ? "bg-amber-400" : "bg-accent"}`}
      />
      AI: {isApi ? "API" : "Paste"} mode
    </button>
  );
}
