import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { getActiveJob, getActiveJobId } from "../../lib/jobs.js";
import {
  addCustomCards,
  deleteCard,
  setCardCategory,
  setCardStage,
  setModelOverride,
  clearModelOverride,
  get,
  set as storeSet,
} from "../../lib/store.js";
import {
  getDeck,
  CATEGORIES,
  categoryLabel,
  stageLabel,
  buildGenerateTask,
  parseGenerated,
  parseModelAnswerText,
  formatModelAnswerText,
} from "./deck.js";
import AttemptPractice from "./AttemptPractice.jsx";

const CONF_FILTERS = [
  { id: "all", label: "All confidence" },
  { id: "unrated", label: "Unrated" },
  { id: "low", label: "Needs work (1–2)" },
  { id: "mid", label: "Getting there (3)" },
  { id: "high", label: "Solid (4–5)" },
];

const NAV_SPLIT_KEY = "flashcards:navSplit";
const NAV_SPLIT_MIN = 0.18;
const NAV_SPLIT_MAX = 0.72;
const NAV_SPLIT_DEFAULT = 0.42;

function clampNavSplit(n) {
  return Math.min(NAV_SPLIT_MAX, Math.max(NAV_SPLIT_MIN, Number(n) || NAV_SPLIT_DEFAULT));
}

function matchesConfidence(card, filter) {
  const c = card.confidence;
  switch (filter) {
    case "unrated":
      return c == null;
    case "low":
      return c === 1 || c === 2;
    case "mid":
      return c === 3;
    case "high":
      return c === 4 || c === 5;
    default:
      return true;
  }
}

// Weakest-first: unrated, then ascending confidence, older review first.
function weakestFirst(a, b) {
  const ca = a.confidence ?? -1;
  const cb = b.confidence ?? -1;
  if (ca !== cb) return ca - cb;
  return (a.lastReviewed ?? 0) - (b.lastReviewed ?? 0);
}

export default function Flashcards() {
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const deck = useMemo(() => getDeck(), [tick]);

  const [cat, setCat] = useState("all");
  const [conf, setConf] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [sortWeak, setSortWeak] = useState(true);
  const [groupByStage, setGroupByStage] = useState(true);
  const stages = useMemo(() => getActiveJob()?.stages || [], [tick]);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // { kind, prompt, title, saveLabel, replyHint }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [navSplit, setNavSplit] = useState(() =>
    clampNavSplit(get(NAV_SPLIT_KEY, NAV_SPLIT_DEFAULT))
  );
  const navStackRef = useRef(null);
  const navSplitRef = useRef(navSplit);
  navSplitRef.current = navSplit;

  const visible = useMemo(() => {
    let list = deck.filter(
      (c) =>
        (cat === "all" || c.category === cat) &&
        matchesConfidence(c, conf) &&
        (stageFilter === "all" ||
          (stageFilter === "unassigned" && !c.stageId) ||
          c.stageId === stageFilter)
    );
    const stageIndex = (id) => {
      if (!id) return stages.length + 1;
      const i = stages.findIndex((s) => s.id === id);
      return i === -1 ? stages.length : i;
    };
    const byStageThenWeak = (a, b) => {
      const si = stageIndex(a.stageId) - stageIndex(b.stageId);
      if (si !== 0) return si;
      return sortWeak ? weakestFirst(a, b) : 0;
    };
    if (groupByStage || sortWeak) {
      list = [...list].sort(groupByStage ? byStageThenWeak : weakestFirst);
    }
    return list;
  }, [deck, cat, conf, stageFilter, sortWeak, groupByStage, stages]);

  // Keep a valid selection as filters change.
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
    } else if (!visible.some((c) => c.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const selected = deck.find((c) => c.id === selectedId) || null;
  const selectedIdx = visible.findIndex((c) => c.id === selectedId);

  const stats = useMemo(() => {
    const answered = deck.filter((c) => c.myAnswer.trim()).length;
    const rated = deck.filter((c) => c.confidence != null);
    const avg =
      rated.length > 0
        ? (rated.reduce((s, c) => s + c.confidence, 0) / rated.length).toFixed(1)
        : "—";
    return { total: deck.length, answered, avg };
  }, [deck]);

  function goRelative(delta) {
    if (visible.length === 0) return;
    const next = (selectedIdx + delta + visible.length) % visible.length;
    setSelectedId(visible[next].id);
  }

  // ---- generate more questions ------------------------------------------------

  async function handleGenerate() {
    setErr("");
    setBusy(true);
    const jobId = getActiveJobId();
    try {
      const task = buildGenerateTask({
        count: 8,
        existingQuestions: deck.map((c) => c.question),
      });
      const result = await coach({ task });
      if (jobId !== getActiveJobId()) return; // job switched mid-flight — drop the result
      if (result.mode === MODE_PASTE) {
        setModal({
          kind: "generate",
          title: "Generate more questions",
          prompt: result.prompt,
          saveLabel: "Add questions",
          replyHint: "Paste the JSON array of questions here…",
        });
      } else {
        saveGenerated(result.text);
      }
    } catch (e) {
      if (jobId !== getActiveJobId()) return;
      setErr(e.message || "Generation failed.");
    } finally {
      if (jobId === getActiveJobId()) setBusy(false);
    }
  }

  function saveGenerated(text) {
    const cards = parseGenerated(text);
    if (cards.length === 0) {
      setErr("Couldn't parse any questions from that reply. Expecting a JSON array.");
      return;
    }
    addCustomCards(cards);
    setModal(null);
    bump();
  }

  function handleModalSave(text) {
    if (modal?.kind === "generate") saveGenerated(text);
  }

  function persistNavSplit(next) {
    const value = clampNavSplit(next);
    setNavSplit(value);
    storeSet(NAV_SPLIT_KEY, value);
    return value;
  }

  function onNavSplitPointerDown(e) {
    e.preventDefault();
    const stack = navStackRef.current;
    if (!stack) return;
    const rect = stack.getBoundingClientRect();
    if (rect.height < 8) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    function onMove(ev) {
      setNavSplit(clampNavSplit((ev.clientY - rect.top) / rect.height));
    }
    function onUp() {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      storeSet(NAV_SPLIT_KEY, navSplitRef.current);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left: filters + list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface/50">
        <div ref={navStackRef} className="flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-[5.5rem] space-y-3 overflow-y-auto p-4"
            style={{ flex: `0 0 ${navSplit * 100}%` }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink1">Flashcards</h2>
              <span className="text-xs text-ink2">{visible.length} shown</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Cards" value={stats.total} />
              <Stat label="Answered" value={stats.answered} />
              <Stat label="Avg conf" value={stats.avg} />
            </div>
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink1 focus:border-accent focus:outline-none"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink1 focus:border-accent focus:outline-none"
            >
              <option value="all">All stages</option>
              <option value="unassigned">Unassigned</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <select
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink1 focus:border-accent focus:outline-none"
            >
              {CONF_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink1">
              <input
                type="checkbox"
                checked={groupByStage}
                onChange={(e) => setGroupByStage(e.target.checked)}
                className="accent-accent"
              />
              Group by stage
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink1">
              <input
                type="checkbox"
                checked={sortWeak}
                onChange={(e) => setSortWeak(e.target.checked)}
                className="accent-accent"
              />
              Sort weakest-first
            </label>
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize filters and question list"
            aria-valuemin={Math.round(NAV_SPLIT_MIN * 100)}
            aria-valuemax={Math.round(NAV_SPLIT_MAX * 100)}
            aria-valuenow={Math.round(navSplit * 100)}
            tabIndex={0}
            onPointerDown={onNavSplitPointerDown}
            onDoubleClick={() => persistNavSplit(NAV_SPLIT_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                persistNavSplit(navSplit - 0.04);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                persistNavSplit(navSplit + 0.04);
              } else if (e.key === "Home") {
                e.preventDefault();
                persistNavSplit(NAV_SPLIT_MIN);
              } else if (e.key === "End") {
                e.preventDefault();
                persistNavSplit(NAV_SPLIT_MAX);
              }
            }}
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-line bg-surface hover:bg-surface2 focus:outline-none focus-visible:bg-accent/10"
          >
            <span className="h-0.5 w-8 rounded-full bg-line transition group-hover:bg-accent/50 group-focus-visible:bg-accent" />
          </div>

          <div className="min-h-[6rem] flex-1 overflow-y-auto p-2">
          {visible.length === 0 && (
            <p className="p-3 text-xs text-ink2">No cards match these filters.</p>
          )}
          {visible.map((c, i) => {
            const prev = visible[i - 1];
            const showHeader =
              groupByStage &&
              (i === 0 || (prev?.stageId || "") !== (c.stageId || ""));
            return (
              <div key={c.id}>
                {showHeader && (
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink2">
                    {stageLabel(c.stageId, stages)}
                  </p>
                )}
                <CardRow
                  card={c}
                  stages={stages}
                  stageTitle={c.stageId ? stageLabel(c.stageId, stages) : null}
                  active={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                  onChanged={bump}
                />
              </div>
            );
          })}
          </div>
        </div>

        <div className="border-t border-line p-3">
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink1 transition hover:border-line disabled:opacity-50"
          >
            {busy ? "Working…" : "+ Generate more questions"}
          </button>
        </div>
      </aside>

      {/* Right: selected card */}
      <div className="flex min-w-0 flex-1 flex-col">
        {err && (
          <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
            {err}
          </div>
        )}

        {selected ? (
          <CardDetail
            key={selected.id}
            card={selected}
            position={selectedIdx + 1}
            total={visible.length}
            onPrev={() => goRelative(-1)}
            onNext={() => goRelative(1)}
            onProgressChange={bump}
            onModelUpdated={bump}
            stageTitle={selected.stageId ? stageLabel(selected.stageId, stages) : null}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink2">
            Select a card to study.
          </div>
        )}
      </div>

      <CoachPasteModal
        open={!!modal}
        title={modal?.title}
        prompt={modal?.prompt || ""}
        saveLabel={modal?.saveLabel}
        replyHint={modal?.replyHint}
        onSave={handleModalSave}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md bg-canvas/60 py-1.5">
      <div className="text-sm font-semibold text-ink1">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink2">{label}</div>
    </div>
  );
}

function CardRow({ card, active, onClick, stageTitle, stages, onChanged }) {
  return (
    <div
      className={`mb-1 flex items-start rounded-lg ${
        active ? "bg-accent/15 ring-1 ring-inset ring-accent/40" : "hover:bg-surface2/60"
      }`}
    >
      <button onClick={onClick} className="min-w-0 flex-1 px-3 py-2.5 text-left">
        <div className="flex items-center gap-2">
          <ConfidenceDot value={card.confidence} />
          <span className="text-[10px] uppercase tracking-wide text-ink2">
            {categoryLabel(card.category)}
          </span>
          {stageTitle && (
            <span className="truncate text-[10px] text-ink2">· {stageTitle}</span>
          )}
          {card.myAnswer.trim() && (
            <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">
              answered
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink1">{card.question}</p>
      </button>
      <CardOverflowMenu card={card} stages={stages} onChanged={onChanged} />
    </div>
  );
}

function MenuAccordion({ label, current, open, onToggle }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink1 hover:bg-surface2"
    >
      <span className="w-3 shrink-0 text-ink2" aria-hidden="true">
        {open ? "▾" : "▸"}
      </span>
      <span>{label}</span>
      <span className="ml-auto min-w-0 truncate text-[10px] text-ink2">{current}</span>
    </button>
  );
}

function CardOverflowMenu({ card, stages, onChanged }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 320 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  function closeMenu() {
    setOpen(false);
    setSection(null);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      closeMenu();
    }
    function onKey(e) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !btnRef.current) return;
    const pad = 8;
    const btn = btnRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - btn.bottom - pad;
    const spaceAbove = btn.top - pad;
    const openUp = spaceBelow < Math.min(menu.height, 240) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(window.innerHeight * 0.7, openUp ? spaceAbove : spaceBelow));
    let top = openUp ? Math.max(pad, btn.top - Math.min(menu.height, maxHeight) - 4) : btn.bottom + 4;
    let left = btn.right - menu.width;
    left = Math.max(pad, Math.min(left, window.innerWidth - menu.width - pad));
    setPos({ top, left, maxHeight });
  }, [open, section]);

  function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      closeMenu();
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const width = 220;
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      maxHeight: Math.max(160, window.innerHeight - r.bottom - 12),
    });
    setSection(null);
    setOpen(true);
  }

  function pick(fn) {
    closeMenu();
    fn?.();
    onChanged?.();
  }

  const itemClass = "block w-full px-3 py-1.5 pl-8 text-left text-xs text-ink1 hover:bg-surface2";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Card options"
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="mr-1 mt-1.5 shrink-0 rounded px-1.5 py-1 text-sm leading-none text-ink2 hover:bg-surface2 hover:text-ink1"
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
            className="fixed z-50 w-[220px] overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg"
          >
            <MenuAccordion
              label="Category"
              current={categoryLabel(card.category)}
              open={section === "category"}
              onToggle={() => setSection((s) => (s === "category" ? null : "category"))}
            />
            {section === "category" &&
              CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="menuitem"
                  onClick={() => pick(() => setCardCategory(card.id, cat.id))}
                  className={itemClass}
                >
                  {card.category === cat.id ? "✓ " : ""}
                  {cat.label}
                </button>
              ))}
            <MenuAccordion
              label="Stage"
              current={stageLabel(card.stageId, stages)}
              open={section === "stage"}
              onToggle={() => setSection((s) => (s === "stage" ? null : "stage"))}
            />
            {section === "stage" && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => pick(() => setCardStage(card.id, null))}
                  className={itemClass}
                >
                  {!card.stageId ? "✓ " : ""}
                  Unassigned
                </button>
                {(stages || []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(() => setCardStage(card.id, s.id))}
                    className={itemClass}
                  >
                    {card.stageId === s.id ? "✓ " : ""}
                    {s.title}
                  </button>
                ))}
              </>
            )}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                setConfirmDelete(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-500/10 dark:text-red-300"
            >
              Delete
            </button>
          </div>,
          document.body
        )}
      {confirmDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-card-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <h3 id="delete-card-title" className="text-sm font-semibold text-ink1">
                Delete this flashcard?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink2">{card.question}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-ink1 hover:bg-surface2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteCard(card.id);
                    setConfirmDelete(false);
                    onChanged?.();
                  }}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

const CONF_COLORS = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-400",
  4: "bg-lime-400",
  5: "bg-emerald-400",
};

function ConfidenceDot({ value }) {
  const color = value == null ? "bg-ink2" : CONF_COLORS[value];
  return (
    <span
      title={value == null ? "Unrated" : `Confidence ${value}/5`}
      className={`h-2 w-2 shrink-0 rounded-full ${color}`}
    />
  );
}

function CardDetail({
  card,
  position,
  total,
  onPrev,
  onNext,
  onProgressChange,
  onModelUpdated,
  stageTitle,
}) {
  const [flipped, setFlipped] = useState(false);
  const [editingModel, setEditingModel] = useState(false);
  const [modelText, setModelText] = useState(() =>
    formatModelAnswerText(card.referenceAnswer, card.keyPoints)
  );
  const [modelSavedTick, setModelSavedTick] = useState(false);

  useEffect(() => {
    setModelText(formatModelAnswerText(card.referenceAnswer, card.keyPoints));
    setEditingModel(false);
    setFlipped(false);
  }, [card.id, card.referenceAnswer, card.keyPoints]);

  function saveModel(referenceAnswer, keyPoints) {
    setModelOverride(card.id, { referenceAnswer, keyPoints });
    setModelText(formatModelAnswerText(referenceAnswer, keyPoints));
    setEditingModel(false);
    setModelSavedTick(true);
    setTimeout(() => setModelSavedTick(false), 1500);
    onModelUpdated?.();
  }

  function resetModel() {
    if (!window.confirm("Reset model answer to the original preloaded version?")) return;
    clearModelOverride(card.id);
    setEditingModel(false);
    onModelUpdated?.();
  }

  function promoteToModel(text) {
    if (!text?.trim()) return;
    const { keyPoints, referenceAnswer } = parseModelAnswerText(text);
    saveModel(referenceAnswer || text.trim(), keyPoints.length ? keyPoints : card.keyPoints);
    setFlipped(true);
  }

  function handleSaveModelEdit() {
    const { keyPoints, referenceAnswer } = parseModelAnswerText(modelText);
    if (!referenceAnswer && keyPoints.length === 0) return;
    saveModel(referenceAnswer, keyPoints);
  }

  const modelDisplay = formatModelAnswerText(card.referenceAnswer, card.keyPoints);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-surface2 px-2.5 py-1 text-[11px] font-medium text-ink1">
              {categoryLabel(card.category)}
            </span>
            {stageTitle && (
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                {stageTitle}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-ink2">
            <button
              onClick={onPrev}
              className="rounded-md px-2 py-1 transition hover:bg-surface2 hover:text-ink1"
            >
              ← Prev
            </button>
            <span>
              {position} / {total}
            </span>
            <button
              onClick={onNext}
              className="rounded-md px-2 py-1 transition hover:bg-surface2 hover:text-ink1"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Flip card — question on front, model answer on back (editable in place) */}
        <div className="[perspective:1600px]">
          <div
            className={`relative w-full transition-transform duration-500 [transform-style:preserve-3d] ${
              editingModel ? "h-[28rem]" : "h-80"
            } ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
          >
            {/* Front — question */}
            <button
              type="button"
              onClick={() => {
                setEditingModel(false);
                setFlipped(true);
              }}
              aria-hidden={flipped}
              tabIndex={flipped ? -1 : 0}
              className={`absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-line bg-gradient-to-br from-surface2 to-surface p-8 text-center shadow-sm [backface-visibility:hidden] ${
                flipped ? "pointer-events-none" : "z-10"
              }`}
            >
              <p className="text-lg font-medium leading-relaxed text-ink1">
                {card.question}
              </p>
              <span className="mt-4 text-xs text-ink2">
                Answer first, then flip to see the model answer →
              </span>
            </button>

            {/* Back — model answer, edit in place */}
            <div
              aria-hidden={!flipped}
              className={`absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-accent/30 bg-surface p-5 text-left shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)] ${
                flipped ? "z-10" : "pointer-events-none"
              }`}
            >
              <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Model answer
                  {card.referenceIsCustom && (
                    <span className="ml-1.5 normal-case text-emerald-600 dark:text-emerald-400">· customized</span>
                  )}
                  {modelSavedTick && (
                    <span className="ml-1.5 normal-case text-emerald-600 dark:text-emerald-400">· saved</span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {!editingModel ? (
                    <>
                      {card.referenceIsCustom && (
                        <button
                          type="button"
                          onClick={resetModel}
                          className="rounded px-2 py-0.5 text-[10px] text-ink2 hover:bg-surface2 hover:text-ink1"
                        >
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingModel(true)}
                        className="rounded bg-surface2 px-2 py-0.5 text-[10px] font-semibold text-ink1 hover:bg-surface2"
                      >
                        Edit
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setModelText(modelDisplay);
                          setEditingModel(false);
                        }}
                        className="rounded px-2 py-0.5 text-[10px] text-ink2 hover:bg-surface2"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveModelEdit}
                        disabled={!modelText.trim()}
                        className="rounded bg-accent px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-accentHover disabled:opacity-40"
                      >
                        Save
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {editingModel ? (
                  <textarea
                    value={modelText}
                    onChange={(e) => setModelText(e.target.value)}
                    className="h-full min-h-[12rem] w-full resize-none rounded-lg border border-line bg-canvas p-3 font-mono text-[13px] leading-relaxed text-ink1 focus:border-accent focus:outline-none"
                  />
                ) : modelDisplay ? (
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink1">
                    {modelDisplay}
                  </pre>
                ) : (
                  <p className="text-sm italic text-ink2">No model answer yet.</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingModel(false);
                  setFlipped(false);
                }}
                className="mt-3 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent transition hover:border-accent/60 hover:bg-accent/20 hover:text-ink1"
              >
                <span aria-hidden="true">↩</span>
                Back to question
              </button>
            </div>
          </div>
        </div>

        <AttemptPractice
          card={card}
          onProgressChange={onProgressChange}
          onPromote={promoteToModel}
        />
      </div>
    </div>
  );
}
