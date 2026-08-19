import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStages, getStageDoc } from "./stages.js";
import {
  getSuggestedStages,
  buildSuggestionBanner,
  shouldShowSuggestions,
} from "./suggestions.js";
import InterviewRecording from "./InterviewRecording.jsx";
import RichDocEditor from "./RichDocEditor.jsx";
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
  getStagePages,
  addStagePage,
  updateStagePage,
  deleteStagePage,
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
  const [activePageId, setActivePageId] = useState(null);
  const [pagesTick, setPagesTick] = useState(0);
  const [expandedIds, setExpandedIds] = useState(() => {
    const id = defaultActiveStageId(refreshStagesFromJob());
    return id ? { [id]: true } : {};
  });
  const bumpProgress = () => setProgressTick((t) => t + 1);
  const bumpPages = () => setPagesTick((t) => t + 1);

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
      const fallback = defaultActiveStageId(next);
      setActivePageId(null);
      return fallback;
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

  useEffect(() => {
    getAllRecordings().then((recs) => {
      const currentIds = new Set(getStages().map((s) => s.id));
      const flags = {};
      for (const r of recs) {
        if (r.status === "done" && currentIds.has(r.stageId)) flags[r.stageId] = true;
      }
      for (const id of Object.keys(flags)) setRecordingFlag(id, true);
    });
  }, [stages]);

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
    setActivePageId(null);
  }

  function handleSelectPage(stageId, pageId) {
    setPreviewSuggestionId(null);
    setActiveId(stageId);
    setActivePageId(pageId);
    setExpandedIds((prev) => ({ ...prev, [stageId]: true }));
  }

  function handleToggleExpand(stageId) {
    setExpandedIds((prev) => ({ ...prev, [stageId]: !prev[stageId] }));
  }

  function handleRenameStage(stageId, title) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const job = getActiveJob();
    const jobId = getActiveJobId();
    if (!job || !jobId) return;
    updateJobStages(
      jobId,
      job.stages.map((s) => (s.id === stageId ? { ...s, title: nextTitle } : s))
    );
    reloadStages(stageId);
  }

  function handleAddPage(stageId) {
    const page = addStagePage(stageId);
    bumpPages();
    handleSelectPage(stageId, page.id);
  }

  function handleRenamePage(stageId, pageId, title) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    updateStagePage(stageId, pageId, { title: nextTitle });
    bumpPages();
  }

  function handleDeletePage(stageId, pageId) {
    deleteStagePage(stageId, pageId);
    const remaining = getStagePages(stageId);
    bumpPages();
    if (remaining.length === 0) {
      setExpandedIds((prev) => ({ ...prev, [stageId]: false }));
    }
    if (activeId === stageId && activePageId === pageId) setActivePageId(null);
  }

  function handleDeleteStage(stageId) {
    const job = getActiveJob();
    const jobId = getActiveJobId();
    if (!job || !jobId) return;
    if (job.stages.length <= 1) {
      setAddErr("Keep at least one stage.");
      return;
    }
    const next = job.stages.filter((s) => s.id !== stageId);
    updateJobStages(jobId, next);
    const prefer = activeId === stageId ? next[0]?.id : activeId;
    reloadStages(prefer);
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
        activePageId={previewSuggestion ? null : activePageId}
        onSelect={handleSelectStage}
        onSelectPage={handleSelectPage}
        expandedIds={expandedIds}
        onToggleExpand={handleToggleExpand}
        onRenameStage={handleRenameStage}
        onAddPage={handleAddPage}
        onRenamePage={handleRenamePage}
        onDeletePage={handleDeletePage}
        onDeleteStage={handleDeleteStage}
        pagesTick={pagesTick}
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
            key={`${activeId}:${activePageId || "main"}:${docNonce}:${pagesTick}`}
            stageId={activeId}
            pageId={activePageId}
            onRecordingChange={() => {}}
            onPageDeleted={() => setActivePageId(null)}
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
  activePageId,
  onSelect,
  onSelectPage,
  expandedIds = {},
  onToggleExpand,
  onRenameStage,
  onAddPage,
  onRenamePage,
  onDeletePage,
  onDeleteStage,
  pagesTick,
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
  // pagesTick / progressTick force a re-read of localStorage after edits.
  void pagesTick;
  void progressTick;
  const stageIds = stages.map((s) => s.id);
  const titleRef = useRef(null);
  const [renamingId, setRenamingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    if (adding) titleRef.current?.focus();
  }, [adding]);

  return (
    <nav className="flex h-full min-h-0 w-80 shrink-0 flex-col gap-1 border-r border-line bg-surface/50 p-3">
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
          const active = s.id === activeId && !activePageId;
          const progress = getStageProgress(s.id, stageIds);
          const pages = getStagePages(s.id);
          const hasPages = pages.length > 0;
          const expanded = hasPages && !!expandedIds[s.id];

          return (
            <div
              key={s.id}
              className={`rounded-lg transition ${
                s.id === activeId
                  ? "bg-accent/15 ring-1 ring-inset ring-accent/40"
                  : "hover:bg-surface2/60"
              }`}
            >
              <div className="flex items-start gap-1 px-1 py-1">
                {hasPages ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand?.(s.id)}
                    className="mt-2 shrink-0 rounded p-0.5 text-ink2 hover:bg-surface2 hover:text-ink1"
                    aria-label={expanded ? `Collapse ${s.title}` : `Expand ${s.title}`}
                  >
                    <ChevronIcon open={expanded} />
                  </button>
                ) : null}
                {renamingId === s.id ? (
                  <div className="min-w-0 flex-1 rounded-md px-1 py-1.5">
                    <StageNavRow
                      s={s}
                      index={i}
                      active={active}
                      progress={progress}
                      renaming
                      onTitleSave={(title) => {
                        onRenameStage?.(s.id, title);
                        setRenamingId(null);
                      }}
                      onTitleCancel={() => setRenamingId(null)}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="min-w-0 flex-1 rounded-md px-1 py-1.5 text-left"
                  >
                    <StageNavRow
                      s={s}
                      index={i}
                      active={active}
                      progress={progress}
                    />
                  </button>
                )}
                {renamingId !== s.id && (
                  <label className="mt-1.5 shrink-0" title="Edit stage status">
                    <span className="sr-only">Status for {s.title}</span>
                    <select
                      value={progress}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
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
                )}
                <div className="mt-1.5 shrink-0">
                  <StageMenu
                    canDelete={stages.length > 1}
                    onRename={() => setRenamingId(s.id)}
                    onAddPage={() => onAddPage?.(s.id)}
                    onDelete={() => setPendingDelete(s)}
                  />
                </div>
              </div>
              {expanded && (
                <div className="mb-1 ml-6 space-y-0.5 pb-1 pr-2">
                  {pages.map((page) => (
                    <div
                      key={page.id}
                      className={`flex items-center gap-1 rounded-md ${
                        activePageId === page.id && s.id === activeId
                          ? "bg-surface"
                          : "hover:bg-surface2/70"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectPage?.(s.id, page.id)}
                        className="min-w-0 flex-1 break-words px-2 py-1 text-left text-xs text-ink1"
                      >
                        {page.title}
                      </button>
                      <InlineRename
                        value={page.title}
                        onSave={(title) => onRenamePage?.(s.id, page.id, title)}
                        ariaLabel={`Rename page ${page.title}`}
                      />
                      <button
                        type="button"
                        title="Delete page"
                        onClick={() => onDeletePage?.(s.id, page.id)}
                        className="rounded px-1 text-[11px] text-ink2 hover:bg-surface2 hover:text-ink1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                      <span className="break-words text-sm font-medium leading-snug text-ink1">
                        {s.title}
                      </span>
                      {s.subtitle && (
                        <p className="mt-1 break-words text-xs leading-snug text-ink2">{s.subtitle}</p>
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

      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`Delete “${pendingDelete.title}”?`}
          body="This removes the stage and any subpages under it. This can’t be undone."
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            onDeleteStage?.(id);
          }}
        />
      )}
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

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function InlineRename({ value, onSave, ariaLabel }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onSave?.(next);
    else setDraft(value);
  }

  if (!editing) {
    return (
      <button
        type="button"
        title={ariaLabel || "Rename"}
        aria-label={ariaLabel || "Rename"}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="shrink-0 rounded px-1 py-0.5 text-[11px] leading-none text-ink2 hover:bg-surface2 hover:text-ink1"
      >
        ✎
      </button>
    );
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="w-16 shrink-0 rounded border border-accent/50 bg-canvas px-1 py-0.5 text-[11px] text-ink1 focus:outline-none"
    />
  );
}

function ConfirmDeleteDialog({ title, body, onCancel, onConfirm }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h3 id="confirm-delete-title" className="text-base font-semibold text-ink1">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink2">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-xs font-medium text-ink1 hover:bg-surface2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function StageMenu({ canDelete, onRename, onAddPage, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(fn) {
    setOpen(false);
    fn?.();
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        title="Stage options"
        aria-label="Stage options"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded px-1.5 py-1 text-sm leading-none text-ink2 hover:bg-surface2 hover:text-ink1"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-line bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => pick(onRename)}
            className="block w-full px-3 py-1.5 text-left text-xs text-ink1 hover:bg-surface2"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => pick(onAddPage)}
            className="block w-full px-3 py-1.5 text-left text-xs text-ink1 hover:bg-surface2"
          >
            Add subpage
          </button>
          <button
            type="button"
            disabled={!canDelete}
            title={canDelete ? "Delete stage" : "Keep at least one stage"}
            onClick={() => {
              if (!canDelete) return;
              pick(onDelete);
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function StageNavRow({ s, index, active, progress, renaming, onTitleSave, onTitleCancel }) {
  const [draft, setDraft] = useState(s.title);
  const ref = useRef(null);

  useEffect(() => {
    setDraft(s.title);
  }, [s.title]);

  useEffect(() => {
    if (renaming) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [renaming]);

  function commit() {
    const next = draft.trim();
    if (next && next !== s.title) onTitleSave?.(next);
    else onTitleCancel?.();
  }

  return (
    <>
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
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
        {renaming ? (
          <input
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") onTitleCancel?.();
            }}
            className="min-w-0 flex-1 rounded border border-accent/50 bg-canvas px-2 py-0.5 text-sm text-ink1 focus:outline-none"
          />
        ) : (
          <span className="min-w-0 break-words text-sm font-medium leading-snug text-ink1">
            {s.title}
          </span>
        )}
      </div>
      {s.subtitle && (
        <p className="mt-1 break-words pl-7 text-xs leading-snug text-ink2">{s.subtitle}</p>
      )}
    </>
  );
}

function SuggestionPreview({ suggestion, busy, onAdd, onAddDraft, onDismiss }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-snug text-ink1">{suggestion.title}</h2>
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

function StageView({ stageId, pageId, onRecordingChange, onPageDeleted }) {
  const base = useMemo(() => getStageDoc(stageId), [stageId]);
  const [override, setOverride] = useState(() => getDocOverride(stageId));
  const [subTab, setSubTab] = useState("prep");
  const [modal, setModal] = useState({ open: false, prompt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedTick, setSavedTick] = useState(false);
  const [toolbarHost, setToolbarHost] = useState(null);
  const page = pageId ? getStagePages(stageId).find((p) => p.id === pageId) : null;

  useEffect(() => {
    if (pageId && !page) onPageDeleted?.();
  }, [pageId, page, onPageDeleted]);

  // Stage may briefly not exist (job switching mid-render / empty stage list) —
  // getStageDoc returns null then. Bail after hooks are called so hook order stays stable.
  if (!base) return null;

  const markdown = override?.markdown ?? base.markdown;
  const html = override?.html;
  const isEdited = !!override;
  const isPage = !!pageId;

  if (isPage && !page) return null;

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

  function persistMain({ html: nextHtml, markdown: nextMd }) {
    setDocOverride(stageId, nextMd, { html: nextHtml });
    setOverride({ markdown: nextMd, html: nextHtml, savedAt: Date.now() });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  }

  function persistPage({ html: nextHtml }) {
    if (!pageId) return;
    updateStagePage(stageId, pageId, { html: nextHtml });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
  }

  function handleReset() {
    clearDocOverride(stageId);
    setOverride(null);
  }

  const heading = isPage ? page.title : base.title;
  const subheading = isPage ? `${base.title} · page` : base.subtitle;
  const showEditorChrome = isPage || subTab === "prep";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-line">
        <div className="flex items-center justify-between gap-4 px-8 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="break-words text-lg font-semibold leading-snug text-ink1">
                {heading}
              </h2>
              {isPage && (
                <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-ink1 ring-1 ring-inset ring-line">
                  page
                </span>
              )}
            </div>
            <p className="text-xs text-ink2">{subheading}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {!isPage && (
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
            )}
            {showEditorChrome && (
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`text-xs transition ${
                    savedTick ? "text-emerald-600 dark:text-emerald-400" : "text-ink2"
                  }`}
                >
                  {savedTick ? "Saved ✓" : "Autosaves locally"}
                </span>
                {!isPage && isEdited && (
                  <button
                    onClick={handleReset}
                    className="rounded-md px-3 py-2 text-xs font-medium text-ink1 transition hover:bg-surface2"
                  >
                    Reset to original
                  </button>
                )}
                {!isPage && (
                  <button
                    onClick={handleRegenerate}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accentHover disabled:opacity-50"
                  >
                    <RegenIcon spinning={busy} />
                    {busy ? "Working…" : "Regenerate"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {showEditorChrome && (
          <div
            ref={setToolbarHost}
            className="flex min-h-[2.25rem] items-center border-t border-line bg-surface px-8 py-1.5"
          />
        )}
      </header>

      {err && (isPage || subTab === "prep") && (
        <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isPage && (
          <div className={subTab === "recording" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <InterviewRecording stageId={stageId} onChange={onRecordingChange} />
          </div>
        )}
        <div className={isPage || subTab === "prep" ? "px-8 py-6" : "hidden"}>
        <article className="mx-auto max-w-3xl">
          {isPage ? (
            <RichDocEditor
              key={page.id}
              html={page.html}
              placeholder="Write this page…"
              onChange={persistPage}
              toolbarHost={toolbarHost}
            />
          ) : (
            <RichDocEditor
              html={html}
              markdown={markdown}
              placeholder="Write your prep notes…"
              onChange={persistMain}
              toolbarHost={toolbarHost}
            />
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
