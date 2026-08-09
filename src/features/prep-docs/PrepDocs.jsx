import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getStages, getStageDoc } from "./stages.js";
import {
  getSuggestedStages,
  buildSuggestionBanner,
  shouldShowSuggestions,
} from "./suggestions.js";
import InterviewRecording from "./InterviewRecording.jsx";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { getAllRecordings } from "../../lib/db.js";
import { getActiveJob, getActiveJobId, updateJobStages } from "../../lib/jobs.js";
import { generateStageDoc, saveStageDoc } from "../../lib/generate.js";
import { buildCustomStage } from "../onboarding/steps.js";
import {
  getDocOverride,
  setDocOverride,
  clearDocOverride,
  hasRecording,
  getRecordingFlags,
  setRecordingFlag,
  getCurrentStageId,
  getStageProgress,
  ensureStageProgressDefaults,
  setStageProgress,
  STAGE_PROGRESS_STATUSES,
  STAGE_PROGRESS_LABELS,
  dismissSuggestion,
} from "../../lib/store.js";

function defaultActiveStageId(stages) {
  const ids = stages.map((s) => s.id);
  ensureStageProgressDefaults(ids);
  const current = getCurrentStageId(ids);
  if (current && stages.some((s) => s.id === current)) return current;
  return stages[0]?.id;
}

function refreshStagesFromJob() {
  return getStages().map((s) => ({ ...s }));
}

export default function PrepDocs() {
  const [stages, setStages] = useState(refreshStagesFromJob);
  const [activeId, setActiveId] = useState(() => defaultActiveStageId(refreshStagesFromJob()));
  const [recordingFlags, setRecordingFlags] = useState(() => getRecordingFlags());
  const [progressTick, setProgressTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addSubtitle, setAddSubtitle] = useState("");
  const [generateOnAdd, setGenerateOnAdd] = useState(true);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [docNonce, setDocNonce] = useState(0);
  const [pasteModal, setPasteModal] = useState({ open: false, prompt: "", stageId: null, title: "" });
  const [suggestions, setSuggestions] = useState(() => getSuggestedStages());
  const [previewSuggestionId, setPreviewSuggestionId] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const bumpProgress = () => setProgressTick((t) => t + 1);

  const reloadSuggestions = useCallback(() => {
    setSuggestions(getSuggestedStages());
  }, []);

  const reloadStages = useCallback((preferActiveId) => {
    const next = refreshStagesFromJob();
    setStages(next);
    ensureStageProgressDefaults(next.map((s) => s.id));
    setActiveId((prev) => {
      const want = preferActiveId || prev;
      if (want && next.some((s) => s.id === want)) return want;
      return defaultActiveStageId(next);
    });
    reloadSuggestions();
    return next;
  }, [reloadSuggestions]);

  useEffect(() => {
    reloadSuggestions();
  }, [reloadSuggestions, stages.length]);

  const previewSuggestion = suggestions.find((s) => s.id === previewSuggestionId) || null;
  const showSuggestions = shouldShowSuggestions(suggestions);
  const banner =
    !bannerDismissed && showSuggestions ? buildSuggestionBanner(suggestions) : null;

  // When pipeline suggestions appear after a recruiter call, mark recruiter complete
  // if it still looks like the active stage.
  useEffect(() => {
    if (!showSuggestions || !banner) return;
    if (!stages.some((s) => s.id === "recruiter")) return;
    const status = getStageProgress("recruiter", stages.map((s) => s.id));
    if (status === "in-progress" || status === "upcoming") {
      setStageProgress("recruiter", "complete");
      bumpProgress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when suggestions first surface
  }, [showSuggestions, banner?.title]);

  useEffect(() => {
    getAllRecordings().then((recs) => {
      const currentIds = new Set(getStages().map((s) => s.id));
      const flags = {};
      for (const r of recs) {
        if (r.status === "done" && currentIds.has(r.stageId)) flags[r.stageId] = true;
      }
      for (const id of Object.keys(flags)) setRecordingFlag(id, true);
      setRecordingFlags({ ...getRecordingFlags(), ...flags });
    });
  }, [stages]);

  const refreshRecordingFlags = useCallback(() => {
    setRecordingFlags({ ...getRecordingFlags() });
  }, []);

  function openAddForm() {
    setAddErr("");
    setAddTitle("");
    setAddSubtitle("");
    setGenerateOnAdd(true);
    setAdding(true);
  }

  function cancelAddForm() {
    if (addBusy) return;
    setAdding(false);
    setAddErr("");
  }

  async function handleCreateStage(e) {
    e?.preventDefault?.();
    const title = addTitle.trim();
    if (!title) {
      setAddErr("Give the stage a title.");
      return;
    }
    const job = getActiveJob();
    const jobId = getActiveJobId();
    if (!job || !jobId) {
      setAddErr("No active job.");
      return;
    }

    setAddBusy(true);
    setAddErr("");
    const stage = {
      ...buildCustomStage(title),
      subtitle: addSubtitle.trim(),
    };

    try {
      updateJobStages(jobId, [...job.stages, stage]);
      setStageProgress(stage.id, "upcoming");
      reloadStages(stage.id);
      setAdding(false);
      setAddTitle("");
      setAddSubtitle("");

      if (generateOnAdd) {
        const result = await generateStageDoc(stage);
        if (jobId !== getActiveJobId()) return;
        if (!getStages().some((s) => s.id === stage.id)) return;
        if (result.mode === MODE_PASTE) {
          setPasteModal({
            open: true,
            prompt: result.prompt,
            stageId: stage.id,
            title: stage.title,
          });
        } else {
          saveStageDoc(stage.id, result.text);
          setDocNonce((n) => n + 1);
        }
      }
    } catch (err) {
      setAddErr(err?.message || "Could not add stage.");
      setAdding(true);
      reloadStages();
    } finally {
      if (jobId === getActiveJobId()) setAddBusy(false);
    }
  }

  function savePasteGenerated(text) {
    if (!pasteModal.stageId) return;
    const id = pasteModal.stageId;
    saveStageDoc(id, text);
    setPasteModal({ open: false, prompt: "", stageId: null, title: "" });
    setActiveId(id);
    setPreviewSuggestionId(null);
    setDocNonce((n) => n + 1);
  }

  function handleSelectStage(id) {
    setPreviewSuggestionId(null);
    setActiveId(id);
  }

  function handlePreviewSuggestion(id) {
    setPreviewSuggestionId(id);
  }

  function handleDismissSuggestion(id) {
    dismissSuggestion(id);
    if (previewSuggestionId === id) setPreviewSuggestionId(null);
    reloadSuggestions();
  }

  async function handleAcceptSuggestion(suggestion, { refreshFromContext = true } = {}) {
    const job = getActiveJob();
    const jobId = getActiveJobId();
    if (!job || !jobId || !suggestion) return;

    setAddBusy(true);
    setAddErr("");
    try {
      const stage = {
        id: suggestion.id,
        title: suggestion.title,
        subtitle: suggestion.subtitle || "",
        ...(suggestion.file ? { file: suggestion.file } : {}),
        ...(suggestion.regenTask ? { regenTask: suggestion.regenTask } : {}),
      };
      if (!job.stages.some((s) => s.id === stage.id)) {
        updateJobStages(jobId, [...job.stages, stage]);
      }
      setStageProgress(stage.id, "upcoming");
      // Persist the draft they reviewed, then optionally refresh from live context.
      if (suggestion.markdown?.trim()) saveStageDoc(stage.id, suggestion.markdown);
      setPreviewSuggestionId(null);
      reloadStages(stage.id);

      if (refreshFromContext) {
        const result = await generateStageDoc(stage);
        if (jobId !== getActiveJobId()) return;
        if (!getStages().some((s) => s.id === stage.id)) return;
        if (result.mode === MODE_PASTE) {
          setPasteModal({
            open: true,
            prompt: result.prompt,
            stageId: stage.id,
            title: stage.title,
          });
        } else {
          saveStageDoc(stage.id, result.text);
          setDocNonce((n) => n + 1);
        }
      } else {
        setDocNonce((n) => n + 1);
      }
    } catch (err) {
      setAddErr(err?.message || "Could not add suggested stage.");
    } finally {
      if (jobId === getActiveJobId()) setAddBusy(false);
      reloadSuggestions();
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <StageNav
        stages={stages}
        activeId={previewSuggestion ? null : activeId}
        onSelect={handleSelectStage}
        recordingFlags={recordingFlags}
        progressTick={progressTick}
        onProgressChange={bumpProgress}
        adding={adding}
        addTitle={addTitle}
        addSubtitle={addSubtitle}
        generateOnAdd={generateOnAdd}
        addBusy={addBusy}
        addErr={addErr}
        onOpenAdd={openAddForm}
        onCancelAdd={cancelAddForm}
        onChangeTitle={setAddTitle}
        onChangeSubtitle={setAddSubtitle}
        onChangeGenerate={setGenerateOnAdd}
        onSubmitAdd={handleCreateStage}
        suggestions={shouldShowSuggestions(suggestions) ? suggestions : []}
        previewSuggestionId={previewSuggestionId}
        onPreviewSuggestion={handlePreviewSuggestion}
        onAcceptSuggestion={(s) => handleAcceptSuggestion(s, { refreshFromContext: true })}
        onDismissSuggestion={handleDismissSuggestion}
        banner={banner}
        onDismissBanner={() => setBannerDismissed(true)}
      />
      {previewSuggestion ? (
        <SuggestionPreview
          suggestion={previewSuggestion}
          busy={addBusy}
          onAdd={() => handleAcceptSuggestion(previewSuggestion, { refreshFromContext: true })}
          onAddDraft={() => handleAcceptSuggestion(previewSuggestion, { refreshFromContext: false })}
          onDismiss={() => handleDismissSuggestion(previewSuggestion.id)}
        />
      ) : activeId ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {addBusy && (
            <div className="shrink-0 border-b border-accent/30 bg-accent/10 px-8 py-2 text-xs text-accent">
              Generating prep doc from your active context…
            </div>
          )}
          <StageView
            key={`${activeId}:${docNonce}`}
            stageId={activeId}
            onRecordingChange={refreshRecordingFlags}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ink2">
          {addBusy ? "Generating prep doc…" : "Select a stage"}
        </div>
      )}
      <CoachPasteModal
        open={pasteModal.open}
        title={`Generate — ${pasteModal.title}`}
        prompt={pasteModal.prompt}
        saveLabel="Save prep doc"
        replyHint="Paste the generated prep doc (Markdown) here…"
        onSave={savePasteGenerated}
        onClose={() => setPasteModal({ open: false, prompt: "", stageId: null, title: "" })}
      />
    </div>
  );
}

function StageNav({
  stages,
  activeId,
  onSelect,
  recordingFlags,
  progressTick,
  onProgressChange,
  adding,
  addTitle,
  addSubtitle,
  generateOnAdd,
  addBusy,
  addErr,
  onOpenAdd,
  onCancelAdd,
  onChangeTitle,
  onChangeSubtitle,
  onChangeGenerate,
  onSubmitAdd,
  suggestions = [],
  previewSuggestionId,
  onPreviewSuggestion,
  onAcceptSuggestion,
  onDismissSuggestion,
  banner,
  onDismissBanner,
}) {
  // progressTick forces a re-read of localStorage after status edits.
  void progressTick;
  const stageIds = stages.map((s) => s.id);
  const titleRef = useRef(null);

  useEffect(() => {
    if (adding) titleRef.current?.focus();
  }, [adding]);

  return (
    <nav className="flex h-full min-h-0 w-72 shrink-0 flex-col gap-1 border-r border-line bg-surface/50 p-3">
      <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-ink2">
        Interview stages
      </p>

      {banner && (
        <div className="mb-2 rounded-lg border border-accent/35 bg-accent/10 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
              {banner.eyebrow}
            </p>
            <button
              type="button"
              onClick={onDismissBanner}
              className="rounded px-1 text-[11px] text-ink2 hover:bg-surface2 hover:text-ink1"
              aria-label="Dismiss suggestion banner"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm font-medium leading-snug text-ink1">{banner.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink1">{banner.body}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {stages.map((s, i) => {
          const active = s.id === activeId;
          const hasOverride = !!getDocOverride(s.id);
          const hasRec = recordingFlags[s.id] || hasRecording(s.id);
          const progress = getStageProgress(s.id, stageIds);

          return (
            <div
              key={s.id}
              className={`rounded-lg transition ${
                active
                  ? "bg-accent/15 ring-1 ring-inset ring-accent/40"
                  : "hover:bg-surface2/60"
              }`}
            >
              <div className="flex items-start gap-1 px-1 py-1">
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left"
                >
                  <StageNavRow
                    s={s}
                    index={i}
                    active={active}
                    progress={progress}
                    hasRec={hasRec}
                    hasOverride={hasOverride}
                  />
                </button>
                <label className="mt-1.5 shrink-0" title="Edit stage status">
                  <span className="sr-only">Status for {s.title}</span>
                  <select
                    value={progress}
                    onChange={(e) => {
                      setStageProgress(s.id, e.target.value);
                      onProgressChange?.();
                    }}
                    className="max-w-[5.75rem] rounded-md border border-line bg-canvas px-1 py-1 text-[10px] font-medium text-ink1 focus:border-accent focus:outline-none"
                  >
                    {STAGE_PROGRESS_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STAGE_PROGRESS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}

        {suggestions.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-line pt-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink2">
              Suggested · review then add
            </p>
            {suggestions.map((s) => {
              const active = s.id === previewSuggestionId;
              return (
                <div
                  key={s.id}
                  className={`rounded-lg border border-dashed transition ${
                    active
                      ? "border-accent/40 bg-surface/80"
                      : "border-line/80 bg-canvas/30 opacity-60 hover:opacity-90"
                  }`}
                >
                  <div className="flex items-start gap-1 px-2 py-2">
                    <button
                      type="button"
                      title={`Add “${s.title}” to prep docs`}
                      disabled={addBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAcceptSuggestion?.(s);
                      }}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/15 text-sm font-semibold leading-none text-accent transition hover:bg-accent hover:text-ink1 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => onPreviewSuggestion?.(s.id)}
                      className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left"
                    >
                      <span className="text-sm font-medium text-ink1">{s.title}</span>
                      {s.subtitle && (
                        <p className="mt-1 text-xs leading-snug text-ink2">{s.subtitle}</p>
                      )}
                    </button>
                  </div>
                  <div className="flex gap-1 px-2 pb-2 pl-9">
                    <button
                      type="button"
                      onClick={() => onPreviewSuggestion?.(s.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-ink2 hover:bg-surface2 hover:text-ink1"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissSuggestion?.(s.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-ink2 hover:bg-surface2 hover:text-ink1"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-line pt-2">
        {adding ? (
          <form onSubmit={onSubmitAdd} className="space-y-2 rounded-lg border border-line bg-canvas/50 p-2">
            <input
              ref={titleRef}
              value={addTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="Stage title"
              disabled={addBusy}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <input
              value={addSubtitle}
              onChange={(e) => onChangeSubtitle(e.target.value)}
              placeholder="Subtitle (optional)"
              disabled={addBusy}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <label className="flex items-start gap-2 text-[11px] text-ink2">
              <input
                type="checkbox"
                checked={generateOnAdd}
                onChange={(e) => onChangeGenerate(e.target.checked)}
                disabled={addBusy}
                className="mt-0.5 h-3.5 w-3.5 rounded border-line bg-canvas text-accent focus:ring-accent"
              />
              <span>Generate prep doc from active context</span>
            </label>
            {addErr && <p className="text-[11px] text-red-600 dark:text-red-300">{addErr}</p>}
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={addBusy}
                className="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-white hover:bg-accentHover disabled:opacity-50"
              >
                {addBusy ? "Working…" : generateOnAdd ? "Add + generate" : "Add stage"}
              </button>
              <button
                type="button"
                onClick={onCancelAdd}
                disabled={addBusy}
                className="rounded-md px-2 py-1.5 text-xs text-ink2 hover:bg-surface2 hover:text-ink1 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={onOpenAdd}
            title="Add a stage"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm font-medium text-ink1 transition hover:border-accent/50 hover:bg-surface hover:text-ink1"
          >
            <PlusIcon />
            Add stage
          </button>
        )}
      </div>
    </nav>
  );
}

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function StageNavRow({ s, index, active, progress, hasRec, hasOverride }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            progress === "complete"
              ? "bg-emerald-600 text-white"
              : progress === "in-progress"
                ? "bg-accent text-white"
                : progress === "pending"
                  ? "bg-surface2 text-ink2"
                  : active
                    ? "bg-accent text-white"
                    : "bg-surface2 text-ink1"
          }`}
        >
          {progress === "complete" ? <CheckIcon /> : index + 1}
        </span>
        <span
          className={`text-sm font-medium ${
            active || progress === "in-progress" ? "text-ink1" : "text-ink1"
          }`}
        >
          {s.title}
        </span>
        {progress === "in-progress" && (
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            now
          </span>
        )}
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
      <p className="mt-1 pl-7 text-xs leading-snug text-ink2">{s.subtitle}</p>
    </>
  );
}

function SuggestionPreview({ suggestion, busy, onAdd, onAddDraft, onDismiss }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink1">{suggestion.title}</h2>
            <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-ink1 ring-1 ring-inset ring-line">
              suggested
            </span>
          </div>
          {suggestion.subtitle && (
            <p className="text-xs text-ink2">{suggestion.subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-md px-3 py-2 text-xs font-medium text-ink2 hover:bg-surface2 hover:text-ink1 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onAddDraft}
            disabled={busy}
            className="rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink1 hover:bg-surface2 disabled:opacity-50"
          >
            Add draft as-is
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accentHover disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add + refresh from context"}
          </button>
        </div>
      </header>
      {busy && (
        <div className="shrink-0 border-b border-accent/30 bg-accent/10 px-8 py-2 text-xs text-accent">
          Adding stage and refreshing the prep doc from your active context…
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <p className="mb-4 text-xs text-ink2">
          Preview only — this stage isn&apos;t on your pipeline until you click Add.
        </p>
        <article className="mx-auto max-w-3xl">
          <div className="rounded-lg px-4 py-3 opacity-90">
            <Markdown>{suggestion.markdown}</Markdown>
          </div>
        </article>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
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

  // Stage may briefly not exist (job switching mid-render / empty stage list) —
  // getStageDoc returns null then. Bail after hooks are called so hook order stays stable.
  if (!base) return null;

  const markdown = override?.markdown ?? base.markdown;
  const isEdited = !!override;

  async function handleRegenerate() {
    setErr("");
    setBusy(true);
    const jobId = getActiveJobId();
    try {
      const result = await coach({ task: base.regenTask });
      if (jobId !== getActiveJobId()) return; // job switched mid-flight — drop the result
      if (!getStages().some((s) => s.id === stageId)) return; // stage removed mid-flight — drop the result
      if (result.mode === MODE_PASTE) {
        setModal({ open: true, prompt: result.prompt });
      } else {
        saveOverride(result.text);
      }
    } catch (e) {
      if (jobId !== getActiveJobId()) return;
      setErr(e.message || "Regenerate failed.");
    } finally {
      if (jobId === getActiveJobId()) setBusy(false);
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink1">
              {base.title}
            </h2>
            {isEdited && subTab === "prep" && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                edited
              </span>
            )}
          </div>
          <p className="text-xs text-ink2">{base.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-surface p-1 text-xs">
            <button
              onClick={() => setSubTab("prep")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                subTab === "prep"
                  ? "bg-accent text-white"
                  : "text-ink1 hover:bg-surface2"
              }`}
            >
              Prep doc
            </button>
            <button
              onClick={() => setSubTab("recording")}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                subTab === "recording"
                  ? "bg-accent text-white"
                  : "text-ink1 hover:bg-surface2"
              }`}
            >
              Recording / Transcript
            </button>
          </div>
          {subTab === "prep" && (
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <span
                className={`text-xs transition ${
                  savedTick ? "text-emerald-600 dark:text-emerald-400" : "text-ink2"
                }`}
              >
                {savedTick ? "Saved ✓" : "Autosaves locally"}
              </span>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accentHover"
              >
                Done
              </button>
            </>
          ) : (
            <>
              {isEdited && (
                <button
                  onClick={handleReset}
                  className="rounded-md px-3 py-2 text-xs font-medium text-ink1 transition hover:bg-surface2"
                >
                  Reset to original
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink1 transition hover:border-line"
              >
                <EditIcon />
                Edit
              </button>
              <button
                onClick={handleRegenerate}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accentHover disabled:opacity-50"
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
        <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
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
      className="w-full resize-none overflow-hidden rounded-lg border border-accent/40 bg-canvas p-4 font-mono text-[13px] leading-relaxed text-ink1 focus:border-accent focus:outline-none"
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
