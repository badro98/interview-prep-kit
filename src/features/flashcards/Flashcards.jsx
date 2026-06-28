import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { setCardProgress, addCustomCards, setModelOverride, clearModelOverride } from "../../lib/store.js";
import { useSpeechRecognition } from "../audio/useSpeechRecognition.js";
import {
  getDeck,
  CATEGORIES,
  categoryLabel,
  buildCoachTask,
  buildGenerateTask,
  parseGenerated,
  parseCoaching,
  parseTightenedVersion,
  formatModelAnswerText,
  parseModelAnswerText,
} from "./deck.js";

const CONF_FILTERS = [
  { id: "all", label: "All confidence" },
  { id: "unrated", label: "Unrated" },
  { id: "low", label: "Needs work (1–2)" },
  { id: "mid", label: "Getting there (3)" },
  { id: "high", label: "Solid (4–5)" },
];

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
  const [sortWeak, setSortWeak] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // { kind, prompt, title, saveLabel, replyHint }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const visible = useMemo(() => {
    let list = deck.filter(
      (c) => (cat === "all" || c.category === cat) && matchesConfidence(c, conf)
    );
    list = sortWeak
      ? [...list].sort(weakestFirst)
      : list; // otherwise keep deck order (seed order)
    return list;
  }, [deck, cat, conf, sortWeak]);

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

  // ---- coach() flows ----------------------------------------------------------

  async function handleCoach(draftAnswer) {
    const answer = String(draftAnswer ?? selected?.myAnswer ?? "").trim();
    if (!selected || !answer) return;
    // Persist the draft we're coaching against (editor may not have blurred yet).
    setCardProgress(selected.id, { myAnswer: answer });
    setErr("");
    setBusy(true);
    try {
      const task = buildCoachTask({ ...selected, myAnswer: answer });
      const result = await coach({ task });
      if (result.mode === MODE_PASTE) {
        setModal({
          kind: "coach",
          title: "Coach me",
          prompt: result.prompt,
          saveLabel: "Save coaching",
          replyHint: "Paste the coaching reply here…",
        });
      } else {
        saveCoaching(result.text);
      }
    } catch (e) {
      const msg = e.message || "Coaching failed.";
      setErr(
        msg.includes("Proxy error") || msg.includes("fetch")
          ? `${msg} — run npm run dev with .env keys, or switch header to Paste mode.`
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  function saveCoaching(text) {
    const { coaching, confidence } = parseCoaching(text);
    const patch = { aiCoaching: coaching };
    if (confidence != null) patch.confidence = confidence;
    setCardProgress(selected.id, patch);
    setModal(null);
    bump();
  }

  async function handleGenerate() {
    setErr("");
    setBusy(true);
    try {
      const task = buildGenerateTask({
        count: 8,
        existingQuestions: deck.map((c) => c.question),
      });
      const result = await coach({ task });
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
      setErr(e.message || "Generation failed.");
    } finally {
      setBusy(false);
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
    if (modal?.kind === "coach") saveCoaching(text);
    else if (modal?.kind === "generate") saveGenerated(text);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left: filters + list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-ink-700 bg-ink-800/50">
        <div className="space-y-3 border-b border-ink-700 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Flashcards</h2>
            <span className="text-xs text-slate-400">{visible.length} shown</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Cards" value={stats.total} />
            <Stat label="Answered" value={stats.answered} />
            <Stat label="Avg conf" value={stats.avg} />
          </div>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
          >
            {CONF_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={sortWeak}
              onChange={(e) => setSortWeak(e.target.checked)}
              className="accent-indigo-500"
            />
            Sort weakest-first
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 && (
            <p className="p-3 text-xs text-slate-500">No cards match these filters.</p>
          )}
          {visible.map((c) => (
            <CardRow
              key={c.id}
              card={c}
              active={c.id === selectedId}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
        </div>

        <div className="border-t border-ink-700 p-3">
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-ink-500 disabled:opacity-50"
          >
            {busy ? "Working…" : "+ Generate more questions"}
          </button>
        </div>
      </aside>

      {/* Right: selected card */}
      <div className="flex min-w-0 flex-1 flex-col">
        {err && (
          <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {err}
          </div>
        )}

        {selected ? (
          <CardDetail
            key={selected.id}
            card={selected}
            position={selectedIdx + 1}
            total={visible.length}
            busy={busy}
            onCoach={handleCoach}
            onPrev={() => goRelative(-1)}
            onNext={() => goRelative(1)}
            onSetConfidence={(n) => {
              setCardProgress(selected.id, { confidence: n });
              bump();
            }}
            onPersistAnswer={bump}
            onModelUpdated={bump}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
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
    <div className="rounded-md bg-ink-900/60 py-1.5">
      <div className="text-sm font-semibold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function CardRow({ card, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 block w-full rounded-lg px-3 py-2.5 text-left transition ${
        active
          ? "bg-accent-500/15 ring-1 ring-inset ring-accent-500/40"
          : "hover:bg-ink-700/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <ConfidenceDot value={card.confidence} />
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {categoryLabel(card.category)}
        </span>
        {card.myAnswer.trim() && (
          <span className="ml-auto text-[10px] text-emerald-400">answered</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-200">
        {card.question}
      </p>
    </button>
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
  const color = value == null ? "bg-slate-600" : CONF_COLORS[value];
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
  busy,
  onCoach,
  onPrev,
  onNext,
  onSetConfidence,
  onPersistAnswer,
  onModelUpdated,
}) {
  const [flipped, setFlipped] = useState(false);
  const [draft, setDraft] = useState(card.myAnswer);
  const [editingModel, setEditingModel] = useState(false);
  const [modelText, setModelText] = useState(() =>
    formatModelAnswerText(card.referenceAnswer, card.keyPoints)
  );
  const [modelSavedTick, setModelSavedTick] = useState(false);

  const tightened = useMemo(
    () => parseTightenedVersion(card.aiCoaching),
    [card.aiCoaching]
  );

  // Reset draft when switching cards.
  useEffect(() => {
    setDraft(card.myAnswer);
    setModelText(formatModelAnswerText(card.referenceAnswer, card.keyPoints));
    setEditingModel(false);
    setFlipped(false);
  }, [card.id, card.myAnswer, card.referenceAnswer, card.keyPoints]);

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
          <span className="rounded-full bg-ink-700 px-2.5 py-1 text-[11px] font-medium text-slate-300">
            {categoryLabel(card.category)}
          </span>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <button
              onClick={onPrev}
              className="rounded-md px-2 py-1 transition hover:bg-ink-700 hover:text-white"
            >
              ← Prev
            </button>
            <span>
              {position} / {total}
            </span>
            <button
              onClick={onNext}
              className="rounded-md px-2 py-1 transition hover:bg-ink-700 hover:text-white"
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
              className={`absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-ink-600 bg-gradient-to-br from-ink-700 to-ink-800 p-8 text-center [backface-visibility:hidden] ${
                flipped ? "pointer-events-none" : "z-10"
              }`}
            >
              <p className="text-lg font-medium leading-relaxed text-white">
                {card.question}
              </p>
              <span className="mt-4 text-xs text-slate-400">
                Answer first, then flip to see the model answer →
              </span>
            </button>

            {/* Back — model answer, edit in place */}
            <div
              aria-hidden={!flipped}
              className={`absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-accent-500/30 bg-ink-800 p-5 text-left [backface-visibility:hidden] [transform:rotateY(180deg)] ${
                flipped ? "z-10" : "pointer-events-none"
              }`}
            >
              <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-400">
                  Model answer
                  {card.referenceIsCustom && (
                    <span className="ml-1.5 normal-case text-emerald-400">· customized</span>
                  )}
                  {modelSavedTick && (
                    <span className="ml-1.5 normal-case text-emerald-400">· saved</span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {!editingModel ? (
                    <>
                      {card.referenceIsCustom && (
                        <button
                          type="button"
                          onClick={resetModel}
                          className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-ink-700 hover:text-white"
                        >
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingModel(true)}
                        className="rounded bg-ink-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:bg-ink-600"
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
                        className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-ink-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveModelEdit}
                        disabled={!modelText.trim()}
                        className="rounded bg-accent-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-accent-400 disabled:opacity-40"
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
                    className="h-full min-h-[12rem] w-full resize-none rounded-lg border border-ink-600 bg-ink-900 p-3 font-mono text-[13px] leading-relaxed text-slate-200 focus:border-accent-500 focus:outline-none"
                  />
                ) : modelDisplay ? (
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-200">
                    {modelDisplay}
                  </pre>
                ) : (
                  <p className="text-sm italic text-slate-500">No model answer yet.</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingModel(false);
                  setFlipped(false);
                }}
                className="mt-3 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-accent-500/40 bg-accent-500/10 px-4 py-2.5 text-sm font-semibold text-accent-300 transition hover:border-accent-400/60 hover:bg-accent-500/20 hover:text-white"
              >
                <span aria-hidden="true">↩</span>
                Back to question
              </button>
            </div>
          </div>
        </div>

        {/* Confidence — coach assigns it; you can still override */}
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">
            Confidence{" "}
            <span className="text-slate-600">
              {card.confidence != null
                ? "(coach-assigned · tap to override)"
                : "(coach assigns on submit · or set manually)"}
            </span>
          </span>
          <ConfidencePicker value={card.confidence} onPick={onSetConfidence} />
        </div>

        {/* Answer editor + coach */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-white">Your answer (draft)</h3>
          <AnswerEditor
            card={card}
            onDraftChange={setDraft}
            onPersist={onPersistAnswer}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => onCoach(draft)}
              disabled={busy || !draft.trim()}
              title={!draft.trim() ? "Write a draft first" : "Get coaching"}
              className="rounded-md bg-accent-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Working…" : "Coach me"}
            </button>
          </div>
        </section>

        {/* Coaching output */}
        {card.aiCoaching && (
          <section className="mt-6 rounded-xl border border-ink-700 bg-ink-800/50 p-5">
            <h3 className="mb-2 text-sm font-semibold text-accent-400">
              Coaching
            </h3>
            <Markdown>{card.aiCoaching}</Markdown>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-700 pt-4">
              <p className="w-full text-[11px] text-slate-500">
                Promote to the model answer on the card back (flip to see it).
              </p>
              {tightened && (
                <button
                  type="button"
                  onClick={() => promoteToModel(tightened)}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  Use tightened version as model
                </button>
              )}
              {draft.trim() && (
                <button
                  type="button"
                  onClick={() => promoteToModel(draft)}
                  className="rounded-md border border-emerald-600/50 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-600/20"
                >
                  Use my draft as model
                </button>
              )}
            </div>
          </section>
        )}

        {card.lastReviewed && (
          <p className="mt-6 text-center text-[11px] text-slate-600">
            Last reviewed {new Date(card.lastReviewed).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function ConfidencePicker({ value, onPick }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            onClick={() => onPick(n)}
            title={`Confidence ${n}/5`}
            className={`h-8 w-8 rounded-md text-sm font-semibold transition ${
              on
                ? `${CONF_COLORS[n]} text-ink-900`
                : "bg-ink-700 text-slate-300 hover:bg-ink-600"
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// Local-state editor with text + audio (Web Speech) input. Persists silently
// while typing, bumps deck on blur so list indicators/sorting refresh without
// reordering mid-keystroke. Transcribed speech is appended to the draft.
function AnswerEditor({ card, onDraftChange, onPersist }) {
  const [text, setText] = useState(card.myAnswer);
  const [saved, setSaved] = useState(false);
  const timer = useRef(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    setText(card.myAnswer);
    onDraftChange?.(card.myAnswer);
  }, [card.id, card.myAnswer, onDraftChange]);

  const persist = useCallback((val) => {
    onDraftChange?.(val);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCardProgress(card.id, { myAnswer: val });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    }, 400);
  }, [card.id, onDraftChange]);

  // Append finalized speech chunks to the draft.
  const appendTranscript = useCallback(
    (chunk) => {
      const base = textRef.current;
      const sep = base && !base.endsWith(" ") && !base.endsWith("\n") ? " " : "";
      const next = base + sep + chunk;
      setText(next);
      persist(next);
    },
    [persist]
  );

  const speech = useSpeechRecognition(appendTranscript);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(e) {
    const val = e.target.value;
    setText(val);
    persist(val);
  }

  function onBlur() {
    clearTimeout(timer.current);
    setCardProgress(card.id, { myAnswer: text });
    onPersist?.();
  }

  return (
    <div>
      <div className="relative">
        <textarea
          value={text}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="Type your answer, or use the mic to answer out loud (STAR-ish: situation, what you did, the result with real numbers)…"
          className="min-h-[140px] w-full resize-y rounded-lg border border-ink-700 bg-ink-900 p-4 pr-14 text-sm leading-relaxed text-slate-200 placeholder:text-slate-500 focus:border-accent-500 focus:outline-none"
        />
        {speech.supported && (
          <button
            type="button"
            onClick={speech.toggle}
            title={speech.listening ? "Stop recording" : "Answer out loud"}
            className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full transition ${
              speech.listening
                ? "animate-pulse bg-red-500 text-white"
                : "bg-ink-700 text-slate-300 hover:bg-ink-600 hover:text-white"
            }`}
          >
            <MicIcon />
          </button>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">
          {speech.listening ? (
            <span className="text-red-400">
              ● Listening{speech.interim ? `: "${speech.interim}"` : "… speak now"}
            </span>
          ) : speech.error ? (
            <span className="text-amber-400">
              {speech.error}
              {speech.error.includes("network") && (
                <span className="mt-0.5 block text-slate-500">
                  For live transcript: open in standalone Chrome. Or type your answer below.
                </span>
              )}
            </span>
          ) : speech.supported ? (
            "Type or tap the mic to answer aloud"
          ) : (
            "Mic transcription needs Chrome — typing works everywhere"
          )}
        </span>
        <span className="text-slate-500">{saved ? "Saved ✓" : "Autosaves locally"}</span>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
    </svg>
  );
}
