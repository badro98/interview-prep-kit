import { useState, useEffect } from "react";
import PrepDocs from "./features/prep-docs/PrepDocs.jsx";
import Flashcards from "./features/flashcards/Flashcards.jsx";
import Audio from "./features/audio/Audio.jsx";
import Advisor from "./features/advisor/Advisor.jsx";
import Context from "./features/context/Context.jsx";
import { APP, DEMO } from "../interview.config.js";
import { getContextSummary } from "./lib/context.js";
import { getMode, setMode, MODE_PASTE, MODE_API } from "./lib/coach.js";
import { applyDemoLocalReset } from "./lib/store.js";

const TABS = [
  { id: "prep", label: "Prep Docs", sub: "Stage-by-stage" },
  { id: "cards", label: "Flashcards", sub: "Behavioral / situational" },
  { id: "audio", label: "Audio", sub: "Record · transcribe · score" },
  { id: "advisor", label: "Advisor", sub: "Chat · readiness · flashcards" },
  { id: "context", label: "Context", sub: "Sources · toggles · custom notes" },
];

export default function App() {
  const [ctx, setCtx] = useState(getContextSummary());
  const [mode, setModeState] = useState(getMode());
  const [tab, setTab] = useState("prep");

  useEffect(() => {
    if (applyDemoLocalReset(DEMO?.localStateVersion)) refreshCtx();
  }, []);

  function refreshCtx() {
    setCtx(getContextSummary());
  }

  function toggleMode() {
    const next = mode === MODE_PASTE ? MODE_API : MODE_PASTE;
    setMode(next);
    setModeState(next);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-ink-700 bg-ink-900/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
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

          <nav className="flex items-center gap-1 rounded-lg bg-ink-800 p-1">
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

        <div className="flex items-center gap-4">
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

      <main className="min-h-0 flex-1">
        {tab === "prep" && <PrepDocs />}
        {tab === "cards" && <Flashcards />}
        {tab === "audio" && <Audio />}
        {tab === "advisor" && <Advisor onContextChange={refreshCtx} />}
        {tab === "context" && <Context onChange={refreshCtx} />}
      </main>
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
