import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getStages, getStageDoc } from "./stages.js";
import InterviewRecording from "./InterviewRecording.jsx";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { getAllRecordings } from "../../lib/db.js";
import {
  getDocOverride,
  setDocOverride,
  clearDocOverride,
  hasRecording,
  getRecordingFlags,
  setRecordingFlag,
} from "../../lib/store.js";

export default function PrepDocs() {
  const stages = useMemo(() => getStages(), []);
  const [activeId, setActiveId] = useState(stages[0]?.id);
  const [recordingFlags, setRecordingFlags] = useState(() => getRecordingFlags());

  useEffect(() => {
    getAllRecordings().then((recs) => {
      const flags = {};
      for (const r of recs) {
        if (r.status === "done") flags[r.stageId] = true;
      }
      for (const id of Object.keys(flags)) setRecordingFlag(id, true);
      setRecordingFlags({ ...getRecordingFlags(), ...flags });
    });
  }, []);

  const refreshRecordingFlags = useCallback(() => {
    setRecordingFlags({ ...getRecordingFlags() });
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <StageNav
        stages={stages}
        activeId={activeId}
        onSelect={setActiveId}
        recordingFlags={recordingFlags}
      />
      {/* Remount on stage change so edit/override state loads fresh per stage. */}
      <StageView
        key={activeId}
        stageId={activeId}
        onRecordingChange={refreshRecordingFlags}
      />
    </div>
  );
}

function StageNav({ stages, activeId, onSelect, recordingFlags }) {
  return (
    <nav className="flex w-64 shrink-0 flex-col gap-1 border-r border-ink-700 bg-ink-800/50 p-3">
      <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Interview stages
      </p>
      {stages.map((s, i) => {
        const active = s.id === activeId;
        const hasOverride = !!getDocOverride(s.id);
        const hasRec = recordingFlags[s.id] || hasRecording(s.id);
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`group rounded-lg px-3 py-2.5 text-left transition ${
              active
                ? "bg-accent-500/15 ring-1 ring-inset ring-accent-500/40"
                : "hover:bg-ink-700/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  active ? "bg-accent-500 text-white" : "bg-ink-600 text-slate-300"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`text-sm font-medium ${
                  active ? "text-white" : "text-slate-200"
                }`}
              >
                {s.title}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {hasRec && (
                  <span
                    title="Has interview recording"
                    className="h-1.5 w-1.5 rounded-full bg-sky-400"
                  />
                )}
                {hasOverride && (
                  <span
                    title="You've edited this doc"
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                  />
                )}
              </span>
            </div>
            <p className="mt-1 pl-7 text-xs leading-snug text-slate-400">
              {s.subtitle}
            </p>
          </button>
        );
      })}
    </nav>
  );
}

function StageView({ stageId, onRecordingChange }) {
  const base = useMemo(() => getStageDoc(stageId), [stageId]);
  const [override, setOverride] = useState(() => getDocOverride(stageId));
  const [subTab, setSubTab] = useState("prep");
  const [modal, setModal] = useState({ open: false, prompt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  const markdown = override?.markdown ?? base.markdown;
  const isEdited = !!override;

  async function handleRegenerate() {
    setErr("");
    setBusy(true);
    try {
      const result = await coach({ task: base.regenTask });
      if (result.mode === MODE_PASTE) {
        setModal({ open: true, prompt: result.prompt });
      } else {
        saveOverride(result.text);
      }
    } catch (e) {
      setErr(e.message || "Regenerate failed.");
    } finally {
      setBusy(false);
    }
  }

  function saveOverride(text) {
    setDocOverride(stageId, text);
    setOverride(getDocOverride(stageId));
    setModal({ open: false, prompt: "" });
  }

  // Called as the user types in edit mode (already debounced by the editor).
  function persistEdit(text) {
    setDocOverride(stageId, text);
    setOverride({ markdown: text, savedAt: Date.now() });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  }

  function handleReset() {
    clearDocOverride(stageId);
    setOverride(null);
    setEditing(false);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-ink-700 px-8 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-white">
              {base.title}
            </h2>
            {isEdited && subTab === "prep" && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                edited
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">{base.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-800 p-1 text-xs">
            <button
              onClick={() => setSubTab("prep")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                subTab === "prep"
                  ? "bg-accent-500 text-white"
                  : "text-slate-300 hover:bg-ink-700"
              }`}
            >
              Prep doc
            </button>
            <button
              onClick={() => setSubTab("recording")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                subTab === "recording"
                  ? "bg-accent-500 text-white"
                  : "text-slate-300 hover:bg-ink-700"
              }`}
            >
              Recording
            </button>
          </div>
          {subTab === "prep" && (
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <span
                className={`text-xs transition ${
                  savedTick ? "text-emerald-400" : "text-slate-500"
                }`}
              >
                {savedTick ? "Saved ✓" : "Autosaves locally"}
              </span>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1.5 rounded-md bg-accent-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accent-400"
              >
                Done
              </button>
            </>
          ) : (
            <>
              {isEdited && (
                <button
                  onClick={handleReset}
                  className="rounded-md px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-ink-700"
                >
                  Reset to original
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-ink-500"
              >
                <EditIcon />
                Edit
              </button>
              <button
                onClick={handleRegenerate}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-accent-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:opacity-50"
              >
                <RegenIcon spinning={busy} />
                {busy ? "Working…" : "Regenerate"}
              </button>
            </>
          )}
        </div>
          )}
        </div>
      </header>

      {err && subTab === "prep" && (
        <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={subTab === "recording" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <InterviewRecording stageId={stageId} onChange={onRecordingChange} />
        </div>
        <div className={subTab === "prep" ? "px-8 py-6" : "hidden"}>
        <article className="mx-auto max-w-3xl">
          {editing ? (
            <DocEditor
              initialValue={markdown}
              onChange={persistEdit}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="rounded-lg px-4 py-3">
              <Markdown>{markdown}</Markdown>
            </div>
          )}
        </article>
        </div>
      </div>

      <CoachPasteModal
        open={modal.open}
        title={`Regenerate — ${base.title}`}
        prompt={modal.prompt}
        saveLabel="Save regenerated doc"
        replyHint="Paste the regenerated prep doc (Markdown) here…"
        onSave={saveOverride}
        onClose={() => setModal({ open: false, prompt: "" })}
      />
    </div>
  );
}

// Inline markdown editor: a self-sizing textarea over the doc source.
// Autosaves (debounced) via onChange; the doc re-renders as Markdown on "Done".
function DocEditor({ initialValue, onChange, onDone }) {
  const [text, setText] = useState(initialValue);
  const ref = useRef(null);
  const timer = useRef(null);

  function autosize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  useLayoutEffect(() => {
    autosize();
    const el = ref.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(e) {
    const val = e.target.value;
    setText(val);
    autosize();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(val), 400);
  }

  function handleKeyDown(e) {
    // Cmd/Ctrl+Enter finishes editing.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer.current);
      onChange(text);
      onDone?.();
    }
  }

  function handleBlur() {
    clearTimeout(timer.current);
    onChange(text);
  }

  return (
    <textarea
      ref={ref}
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      spellCheck={false}
      className="w-full resize-none overflow-hidden rounded-lg border border-accent-500/40 bg-ink-900 p-4 font-mono text-[13px] leading-relaxed text-slate-200 focus:border-accent-500 focus:outline-none"
    />
  );
}

function RegenIcon({ spinning }) {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
