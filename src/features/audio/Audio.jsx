import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import {
  addAttempt,
  updateAttempt,
  deleteAttempt,
  getAllAttempts,
} from "../../lib/db.js";
import { useSpeechRecognition } from "./useSpeechRecognition.js";
import { useRecorder } from "./useRecorder.js";
import { buildScoreTask } from "./scoring.js";
import { scoreAttemptAudio, getProxyStatus } from "./geminiScore.js";
import { getDeck, CATEGORIES, categoryLabel } from "../flashcards/deck.js";
import MicLevelBar from "../../components/MicLevelBar.jsx";

function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Audio() {
  const deck = useMemo(() => getDeck(), []);
  const [mode, setMode] = useState(deck.length ? "card" : "freeform");
  const [selectedCardId, setSelectedCardId] = useState(deck[0]?.id || "");
  const [freeform, setFreeform] = useState("");

  const [attempts, setAttempts] = useState([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState(null);
  const [onlyThisQuestion, setOnlyThisQuestion] = useState(false);

  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");

  const [modal, setModal] = useState(null); // { attemptId, prompt }
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState(null); // 'audio' | 'text'
  const [err, setErr] = useState("");
  const [proxy, setProxy] = useState({ reachable: false, configured: false });

  const appendFinal = useCallback((chunk) => {
    setTranscript((prev) => {
      const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      const next = prev + sep + chunk;
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const speech = useSpeechRecognition(appendFinal);
  const recorder = useRecorder();

  const currentQuestion = useMemo(() => {
    if (mode === "card") {
      const c = deck.find((x) => x.id === selectedCardId);
      if (!c) return null;
      return {
        questionId: c.id,
        questionText: c.question,
        category: c.category,
        referenceAnswer: c.referenceAnswer,
        keyPoints: c.keyPoints,
        source: "flashcard",
      };
    }
    return {
      questionId: "freeform",
      questionText: freeform.trim(),
      category: null,
      referenceAnswer: "",
      keyPoints: [],
      source: "freeform",
    };
  }, [mode, deck, selectedCardId, freeform]);

  const canRecord = !!currentQuestion?.questionText;

  const reload = useCallback(async () => {
    const list = await getAllAttempts();
    setAttempts(list);
    return list;
  }, []);

  useEffect(() => {
    reload();
    getProxyStatus().then(setProxy);
  }, [reload]);

  async function handleStart() {
    setErr("");
    setTranscript("");
    transcriptRef.current = "";
    const ok = await recorder.start();
    if (!ok) return;
    if (speech.supported) speech.start();
  }

  async function handleStop() {
    const result = await recorder.stop();
    speech.stop();
    const finalTranscript = transcriptRef.current.trim();
    if (!result) return;
    const q = currentQuestion;
    const saved = await addAttempt({
      questionId: q.questionId,
      questionText: q.questionText,
      category: q.category,
      source: q.source,
      referenceAnswer: q.referenceAnswer,
      keyPoints: q.keyPoints,
      transcript: finalTranscript,
      audioBlob: result.blob,
      audioType: result.type,
      durationMs: result.durationMs,
    });
    await reload();
    setSelectedAttemptId(saved.id);
    setTranscript("");
  }

  // Primary: Gemini listens to the audio and judges tone + content.
  async function handleScoreAudio(attempt) {
    setErr("");
    setBusy(true);
    setBusyKind("audio");
    try {
      const status = await getProxyStatus();
      setProxy(status);
      if (!status.reachable) {
        throw new Error(
          "Audio scoring needs the local API server. Run `npm run dev` (not `npm run dev:frontend`)."
        );
      }
      if (!status.configured) {
        throw new Error(
          "Add GEMINI_API_KEY to your .env, then restart `npm run dev`."
        );
      }
      const text = await scoreAttemptAudio(attempt);
      await saveScore(attempt.id, text);
    } catch (e) {
      setErr(e.message || "Audio scoring failed.");
    } finally {
      setBusy(false);
      setBusyKind(null);
    }
  }

  // Fallback: transcript-only scoring through the shared coach() seam (paste mode works).
  async function handleScoreText(attempt) {
    setErr("");
    setBusy(true);
    setBusyKind("text");
    try {
      const task = buildScoreTask(attempt);
      const res = await coach({ task });
      if (res.mode === MODE_PASTE) {
        setModal({ attemptId: attempt.id, prompt: res.prompt });
      } else {
        await saveScore(attempt.id, res.text);
      }
    } catch (e) {
      setErr(e.message || "Scoring failed.");
    } finally {
      setBusy(false);
      setBusyKind(null);
    }
  }

  async function saveScore(id, text) {
    await updateAttempt(id, { score: text });
    await reload();
    setModal(null);
  }

  async function handleDelete(id) {
    await deleteAttempt(id);
    const list = await reload();
    if (selectedAttemptId === id) setSelectedAttemptId(list[0]?.id || null);
  }

  const selectedAttempt = attempts.find((a) => a.id === selectedAttemptId) || null;

  const visibleAttempts =
    onlyThisQuestion && currentQuestion
      ? attempts.filter((a) => a.questionId === currentQuestion.questionId)
      : attempts;

  const sameQuestionAttempts = selectedAttempt
    ? attempts.filter((a) => a.questionId === selectedAttempt.questionId)
    : [];

  return (
    <div className="flex h-full min-h-0">
      {/* Left: setup + history */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-ink-700 bg-ink-800/50">
        <div className="space-y-3 border-b border-ink-700 p-4">
          <h2 className="text-sm font-semibold text-white">Practice out loud</h2>

          <div className="flex gap-1 rounded-lg bg-ink-900 p-1 text-xs">
            <button
              onClick={() => setMode("card")}
              disabled={!deck.length}
              className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                mode === "card"
                  ? "bg-accent-500 text-white"
                  : "text-slate-300 hover:bg-ink-700"
              }`}
            >
              From deck
            </button>
            <button
              onClick={() => setMode("freeform")}
              className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                mode === "freeform"
                  ? "bg-accent-500 text-white"
                  : "text-slate-300 hover:bg-ink-700"
              }`}
            >
              Freeform
            </button>
          </div>

          {mode === "card" ? (
            <select
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value)}
              className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
            >
              {CATEGORIES.map((cat) => {
                const cards = deck.filter((c) => c.category === cat.id);
                if (!cards.length) return null;
                return (
                  <optgroup key={cat.id} label={cat.label}>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.question.length > 60
                          ? c.question.slice(0, 60) + "…"
                          : c.question}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Type any question to practice…"
              className="h-20 w-full resize-none rounded-md border border-ink-600 bg-ink-900 p-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-accent-500 focus:outline-none"
            />
          )}

          {currentQuestion?.questionText && (
            <p className="rounded-md bg-ink-900/60 p-2 text-xs leading-snug text-slate-300">
              {currentQuestion.questionText}
            </p>
          )}

          {/* Record button */}
          <button
            onClick={recorder.recording ? handleStop : handleStart}
            disabled={!canRecord}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              recorder.recording
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-accent-500 text-white hover:bg-accent-400"
            }`}
          >
            {recorder.recording ? (
              <>
                <StopIcon /> Stop · {fmtDuration(recorder.elapsedMs)}
              </>
            ) : (
              <>
                <MicIcon /> Record answer
              </>
            )}
          </button>

          {(recorder.error || speech.error) && (
            <p className="text-xs text-amber-400">
              {recorder.error || speech.error}
              {speech.error?.includes("network") && (
                <span className="mt-1 block text-slate-400">
                  Tip: open{" "}
                  <strong className="text-slate-300">http://localhost:5175</strong> in
                  standalone <strong className="text-slate-300">Google Chrome</strong>{" "}
                  (not Cursor&apos;s preview). Watch the mic level bar while recording —
                  green bars = audio is being captured even without a transcript.
                </span>
              )}
            </p>
          )}
          {!recorder.supported && (
            <p className="text-xs text-slate-500">
              Recording needs Chrome.
            </p>
          )}
          {recorder.supported && !speech.supported && (
            <p className="text-xs text-slate-500">
              Audio will record, but live transcript needs Chrome.
            </p>
          )}
        </div>

        {/* History */}
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Attempts ({visibleAttempts.length})
          </h3>
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={onlyThisQuestion}
              onChange={(e) => setOnlyThisQuestion(e.target.checked)}
              className="accent-indigo-500"
            />
            This question
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visibleAttempts.length === 0 && (
            <p className="p-3 text-xs text-slate-500">
              No attempts yet. Record one above.
            </p>
          )}
          {visibleAttempts.map((a) => (
            <AttemptRow
              key={a.id}
              attempt={a}
              active={a.id === selectedAttemptId}
              onClick={() => setSelectedAttemptId(a.id)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      </aside>

      {/* Right: live recording OR selected attempt */}
      <div className="flex min-w-0 flex-1 flex-col">
        {err && (
          <div className="mx-8 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {err}
          </div>
        )}

        {recorder.recording ? (
          <LivePanel
            elapsed={recorder.elapsedMs}
            micLevel={recorder.micLevel}
            transcript={transcript}
            interim={speech.interim}
            speechError={speech.error}
            question={currentQuestion?.questionText}
            onStop={handleStop}
          />
        ) : selectedAttempt ? (
          <AttemptDetail
            key={selectedAttempt.id}
            attempt={selectedAttempt}
            busy={busy}
            busyKind={busyKind}
            proxy={proxy}
            siblings={sameQuestionAttempts}
            onScoreAudio={() => handleScoreAudio(selectedAttempt)}
            onScoreText={() => handleScoreText(selectedAttempt)}
            onSelectSibling={setSelectedAttemptId}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-slate-500">
            <MicIcon big />
            <p className="text-sm">Pick a question and record an answer to begin.</p>
          </div>
        )}
      </div>

      <CoachPasteModal
        open={!!modal}
        title="Score my spoken answer"
        prompt={modal?.prompt || ""}
        saveLabel="Save score"
        replyHint="Paste the scoring reply here…"
        onSave={(text) => modal && saveScore(modal.attemptId, text)}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function LivePanel({ elapsed, micLevel, transcript, interim, speechError, question, onStop }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-3 w-3 items-center justify-center">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-red-500/60" />
            <span className="h-3 w-3 rounded-full bg-red-500" />
          </span>
          <span className="font-mono text-sm text-red-400">
            Recording · {fmtDuration(elapsed)}
          </span>
          <button
            onClick={onStop}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
          >
            <StopIcon /> Stop
          </button>
        </div>
        {question && (
          <p className="mb-4 rounded-lg border border-ink-700 bg-ink-800/60 p-3 text-sm text-slate-300">
            {question}
          </p>
        )}

        <div className="mb-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
          <MicLevelBar level={micLevel} />
          <p className="mt-2 text-[11px] text-slate-500">
            Green bars = mic is working. Use this to confirm audio is being captured.
          </p>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Live transcript
          </h3>
          {transcript || interim ? (
            <p className="text-[15px] leading-relaxed text-slate-200">
              {transcript}
              {interim && <span className="text-slate-500"> {interim}</span>}
            </p>
          ) : speechError ? (
            <p className="text-sm text-amber-400/90">{speechError}</p>
          ) : (
            <p className="text-sm italic text-slate-500">
              Start speaking… your words will appear here (Chrome only).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AttemptDetail({
  attempt,
  busy,
  busyKind,
  proxy,
  siblings,
  onScoreAudio,
  onScoreText,
  onSelectSibling,
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-ink-700 px-2.5 py-1 text-[11px] font-medium text-slate-300">
            {attempt.source === "flashcard"
              ? categoryLabel(attempt.category)
              : "Freeform"}
          </span>
          <span className="text-xs text-slate-500">
            {fmtDate(attempt.createdAt)} · {fmtDuration(attempt.durationMs)}
          </span>
        </div>
        <h2 className="text-lg font-semibold leading-snug text-white">
          {attempt.questionText}
        </h2>

        <div className="mt-4">
          <AttemptPlayer attempt={attempt} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={onScoreAudio}
            disabled={busy}
            title="Gemini listens to your recording and judges tone + content"
            className="flex items-center gap-1.5 rounded-md bg-accent-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accent-400 disabled:opacity-50"
          >
            <MicIcon />
            {busy && busyKind === "audio"
              ? "Listening…"
              : attempt.score
              ? "Re-score tone + content"
              : "Score tone + content"}
          </button>
          <button
            onClick={onScoreText}
            disabled={busy}
            title="Score from transcript only (works in Paste mode when proxy is off)"
            className="rounded-md border border-ink-600 bg-ink-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-ink-500 disabled:opacity-50"
          >
            {busy && busyKind === "text" ? "Working…" : "From transcript (paste)"}
          </button>
          {siblings.length > 1 && (
            <span className="text-xs text-slate-500">
              {siblings.length} attempts on this question
            </span>
          )}
        </div>

        {!proxy?.reachable && (
          <p className="mt-2 text-[11px] text-slate-500">
            Tone scoring needs the local API server — run{" "}
            <code className="rounded bg-ink-700 px-1 text-slate-300">npm run dev</code>{" "}
            with a <code className="rounded bg-ink-700 px-1 text-slate-300">GEMINI_API_KEY</code>{" "}
            in <code className="rounded bg-ink-700 px-1 text-slate-300">.env</code>. Until then, use transcript (paste) scoring.
          </p>
        )}
        {proxy?.reachable && !proxy?.configured && (
          <p className="mt-2 text-[11px] text-amber-400">
            API server is running but no Gemini key is set — add GEMINI_API_KEY to .env and restart.
          </p>
        )}

        {/* Transcript */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-white">Transcript</h3>
          {attempt.transcript ? (
            <p className="whitespace-pre-wrap rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm leading-relaxed text-slate-200">
              {attempt.transcript}
            </p>
          ) : (
            <p className="rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm italic text-slate-500">
              No transcript captured (mic transcript needs Chrome). You can still
              replay the audio and score from listening.
            </p>
          )}
        </section>

        {/* Score */}
        {attempt.score && (
          <section className="mt-6 rounded-xl border border-ink-700 bg-ink-800/50 p-5">
            <h3 className="mb-2 text-sm font-semibold text-accent-400">
              Delivery score
            </h3>
            <Markdown>{attempt.score}</Markdown>
          </section>
        )}

        {/* Compare prior attempts */}
        {siblings.length > 1 && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-white">
              Compare attempts on this question
            </h3>
            <div className="space-y-1">
              {siblings.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelectSibling(s.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition ${
                    s.id === attempt.id
                      ? "bg-accent-500/15 ring-1 ring-inset ring-accent-500/30"
                      : "hover:bg-ink-700/60"
                  }`}
                >
                  <span className="text-slate-300">{fmtDate(s.createdAt)}</span>
                  <span className="text-slate-500">{fmtDuration(s.durationMs)}</span>
                  {s.score ? (
                    <span className="ml-auto text-emerald-400">scored</span>
                  ) : (
                    <span className="ml-auto text-slate-600">unscored</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AttemptPlayer({ attempt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!attempt.audioBlob) return;
    const u = URL.createObjectURL(attempt.audioBlob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [attempt.audioBlob]);

  if (!url) return null;
  return <audio controls src={url} className="w-full" />;
}

function AttemptRow({ attempt, active, onClick, onDelete }) {
  return (
    <div
      className={`group mb-1 flex items-start gap-2 rounded-lg px-3 py-2.5 transition ${
        active
          ? "bg-accent-500/15 ring-1 ring-inset ring-accent-500/40"
          : "hover:bg-ink-700/60"
      }`}
    >
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span>{fmtDate(attempt.createdAt)}</span>
          <span>· {fmtDuration(attempt.durationMs)}</span>
          {attempt.score && (
            <span className="ml-auto text-emerald-400">scored</span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-200">
          {attempt.questionText}
        </p>
      </button>
      <button
        onClick={onDelete}
        title="Delete attempt"
        className="shrink-0 rounded p-1 text-slate-600 opacity-0 transition hover:bg-ink-600 hover:text-red-400 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

function MicIcon({ big }) {
  return (
    <svg
      className={big ? "h-8 w-8" : "h-4 w-4"}
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

function StopIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
