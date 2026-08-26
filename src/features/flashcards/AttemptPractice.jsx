import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../components/Markdown.jsx";
import CoachPasteModal from "../../components/CoachPasteModal.jsx";
import MicWaveform from "../../components/MicWaveform.jsx";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { updateAttempt } from "../../lib/db.js";
import { getActiveJobId } from "../../lib/jobs.js";
import { useSpeechRecognition } from "../audio/useSpeechRecognition.js";
import { useRecorder } from "../audio/useRecorder.js";
import { buildScoreTask } from "../audio/scoring.js";
import { scoreAttemptAudio, getProxyStatus } from "../audio/geminiScore.js";
import {
  parseCoaching,
  parseTightenedVersion,
} from "./deck.js";
import {
  createBlankAttempt,
  loadCardAttempts,
  patchAttempt,
  projectAttempt,
} from "./attempts.js";

function fmtDuration(ms) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CONF_COLORS = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-400",
  4: "bg-lime-400",
  5: "bg-emerald-400",
};

export default function AttemptPractice({ card, onProgressChange, onPromote }) {
  const [attempts, setAttempts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState(null);
  const [err, setErr] = useState("");
  const [proxy, setProxy] = useState({ reachable: false, configured: false });
  const [modal, setModal] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [saved, setSaved] = useState(false);
  const transcriptRef = useRef("");
  const liveRef = useRef("");
  const activeIdRef = useRef(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const timer = useRef(null);

  const recorder = useRecorder();
  const appendLive = useCallback((chunk) => {
    setLiveText((prev) => {
      const next = `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${chunk}`;
      liveRef.current = next;
      return next;
    });
  }, []);
  const speech = useSpeechRecognition(appendLive);

  const reload = useCallback(async () => {
    const { attempts: list, activeId: nextId } = await loadCardAttempts(cardRef.current);
    setAttempts(list);
    setActiveId(nextId);
    activeIdRef.current = nextId;
    const found = list.find((a) => a.id === nextId) || null;
    const text = found?.transcript || "";
    setTranscript(text);
    transcriptRef.current = text;
    return { list, activeId: nextId, active: found };
  }, [card.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (!cancelled) getProxyStatus().then(setProxy);
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [reload]);

  const active = attempts.find((a) => a.id === activeId) || null;
  activeIdRef.current = activeId;
  const activeIndex = attempts.findIndex((a) => a.id === activeId);
  const tightened = useMemo(
    () => parseTightenedVersion(active?.score),
    [active?.score]
  );

  function bump(updated) {
    if (updated) {
      setAttempts((list) => {
        const idx = list.findIndex((a) => a.id === updated.id);
        if (idx < 0) return [...list, updated].sort((a, b) => a.createdAt - b.createdAt);
        const next = [...list];
        next[idx] = updated;
        return next;
      });
      setActiveId(updated.id);
      activeIdRef.current = updated.id;
    }
    onProgressChange?.();
  }

  async function selectAttempt(id) {
    const found = attempts.find((a) => a.id === id);
    if (!found) return;
    setActiveId(id);
    setTranscript(found.transcript || "");
    transcriptRef.current = found.transcript || "";
    await patchAttempt(cardRef.current.id, id, {}, { touch: false });
    onProgressChange?.();
  }

  async function handleNewAttempt() {
    setErr("");
    const created = await createBlankAttempt(cardRef.current);
    setAttempts((list) => [...list, created]);
    setActiveId(created.id);
    activeIdRef.current = created.id;
    setTranscript("");
    transcriptRef.current = "";
    onProgressChange?.();
  }

  async function ensureAttempt() {
    const current = cardRef.current;
    if (active) return active;
    const created = await createBlankAttempt(current);
    setAttempts([created]);
    setActiveId(created.id);
    activeIdRef.current = created.id;
    return created;
  }

  async function handleStart() {
    setErr("");
    liveRef.current = "";
    setLiveText("");
    const ok = await recorder.start();
    if (!ok) return;
    if (speech.supported) speech.start();
  }

  async function handleStop() {
    const result = await recorder.stop();
    speech.stop();
    const spoken = liveRef.current.trim();
    if (!result) return;
    const current = cardRef.current;
    const jobId = getActiveJobId();
    const target = await ensureAttempt();
    if (jobId !== getActiveJobId()) return;
    const text = spoken || transcriptRef.current;
    const updated = await updateAttempt(target.id, {
      transcript: text,
      audioBlob: result.blob,
      audioType: result.type,
      durationMs: result.durationMs,
      lastReviewed: Date.now(),
      questionText: current.question,
      referenceAnswer: current.referenceAnswer,
      keyPoints: current.keyPoints,
    });
    projectAttempt(current.id, updated, { touch: true });
    setTranscript(text);
    transcriptRef.current = text;
    liveRef.current = "";
    setLiveText("");
    bump(updated);
  }

  const persistTranscript = useCallback((val) => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const current = cardRef.current;
      let attemptId = activeIdRef.current;
      if (!attemptId) {
        const created = await createBlankAttempt(current);
        setAttempts([created]);
        setActiveId(created.id);
        activeIdRef.current = created.id;
        attemptId = created.id;
      }
      const updated = await patchAttempt(current.id, attemptId, { transcript: val });
      bump(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    }, 400);
  }, []);

  function onTranscriptChange(e) {
    const val = e.target.value;
    setTranscript(val);
    transcriptRef.current = val;
    persistTranscript(val);
  }

  async function applyScore(attemptId, raw) {
    const { coaching, confidence } = parseCoaching(raw);
    const current = cardRef.current;
    const patch = { score: coaching };
    if (confidence != null) patch.confidence = confidence;
    const updated = await patchAttempt(current.id, attemptId, patch);
    bump(updated);
    setModal(null);
  }

  async function handleScoreAudio() {
    const target = active;
    if (!target?.audioBlob) return;
    setErr("");
    setBusy(true);
    setBusyKind("audio");
    const jobId = getActiveJobId();
    try {
      const status = await getProxyStatus();
      setProxy(status);
      if (!status.reachable) {
        throw new Error(
          "Tone scoring needs the local API server. Run `npm run dev` (not `npm run dev:frontend`)."
        );
      }
      if (!status.configured) {
        throw new Error("Add GEMINI_API_KEY to your .env, then restart `npm run dev`.");
      }
      const text = await scoreAttemptAudio(target);
      if (jobId !== getActiveJobId()) return;
      await applyScore(target.id, text);
    } catch (e) {
      if (jobId !== getActiveJobId()) return;
      setErr(e.message || "Audio scoring failed.");
    } finally {
      if (jobId === getActiveJobId()) {
        setBusy(false);
        setBusyKind(null);
      }
    }
  }

  async function handleScoreText() {
    const answer = String(transcript || active?.transcript || "").trim();
    if (!answer) return;
    setErr("");
    setBusy(true);
    setBusyKind("text");
    const jobId = getActiveJobId();
    try {
      const current = cardRef.current;
      const target = await ensureAttempt();
      await patchAttempt(current.id, target.id, { transcript: answer });
      const task = buildScoreTask({
        questionText: current.question,
        transcript: answer,
        referenceAnswer: current.referenceAnswer,
        keyPoints: current.keyPoints,
      });
      const res = await coach({ task });
      if (jobId !== getActiveJobId()) return;
      if (res.mode === MODE_PASTE) {
        setModal({ attemptId: target.id, prompt: res.prompt });
      } else {
        await applyScore(target.id, res.text);
      }
    } catch (e) {
      if (jobId !== getActiveJobId()) return;
      const msg = e.message || "Scoring failed.";
      setErr(
        msg.includes("Proxy error") || msg.includes("fetch")
          ? `${msg} — run npm run dev with .env keys, or switch header to Paste mode.`
          : msg
      );
    } finally {
      if (jobId === getActiveJobId()) {
        setBusy(false);
        setBusyKind(null);
      }
    }
  }

  async function handleSetConfidence(n) {
    const current = cardRef.current;
    const target = await ensureAttempt();
    const updated = await patchAttempt(current.id, target.id, { confidence: n });
    bump(updated);
  }

  const canScoreAudio = !!active?.audioBlob;
  const canScoreText = Boolean(String(transcript || "").trim());

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink1">
          {attempts.length === 0
            ? "Your answer"
            : `Attempt ${activeIndex + 1} of ${attempts.length}`}
        </h3>
        <button
          type="button"
          onClick={handleNewAttempt}
          disabled={busy || recorder.recording}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink1 transition hover:bg-surface2 disabled:opacity-40"
        >
          New attempt
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium text-ink2">
          Confidence{" "}
          <span className="text-ink2">
            {active?.confidence != null
              ? "(scored · tap to override)"
              : "(assigned on score · or set manually)"}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = active?.confidence === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => handleSetConfidence(n)}
                title={`Confidence ${n}/5`}
                className={`h-8 w-8 rounded-md text-sm font-semibold transition ${
                  on ? `${CONF_COLORS[n]} text-black` : "bg-surface2 text-ink1 hover:bg-surface2"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={recorder.recording ? handleStop : handleStart}
        disabled={busy}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          recorder.recording
            ? "bg-red-500 text-white hover:bg-red-600"
            : "bg-accent text-white hover:bg-accentHover"
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
        <p className="mt-2 text-xs text-amber-400">
          {recorder.error || speech.error}
          {speech.error?.includes("network") && (
            <span className="mt-1 block text-ink2">
              Tip: open in standalone Google Chrome (not Cursor&apos;s preview). The
              waveform still moves if audio is captured even without a transcript.
            </span>
          )}
        </p>
      )}
      {!recorder.supported && (
        <p className="mt-2 text-xs text-ink2">Recording needs Chrome. You can still type a transcript and score it.</p>
      )}

      {recorder.recording && (
        <div className="mt-3 space-y-3">
          <MicWaveform samplesRef={recorder.samplesRef} />
          <div className="rounded-xl border border-line bg-canvas p-4">
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink2">
              Live transcript
            </h4>
            {liveText || speech.interim ? (
              <p className="text-sm leading-relaxed text-ink1">
                {liveText}
                {speech.interim && <span className="text-ink2"> {speech.interim}</span>}
              </p>
            ) : (
              <p className="text-sm italic text-ink2">Start speaking… (Chrome only)</p>
            )}
          </div>
        </div>
      )}

      {active?.audioBlob && !recorder.recording && (
        <div className="mt-4">
          <AttemptPlayer attempt={active} />
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 text-sm font-semibold text-ink1">Transcript</h4>
        <textarea
          value={transcript}
          onChange={onTranscriptChange}
          placeholder="Type your answer, or record above — the live transcript lands here (STAR-ish: situation, what you did, the result with real numbers)…"
          className="min-h-[140px] w-full resize-y rounded-lg border border-line bg-canvas p-4 text-sm leading-relaxed text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none"
        />
        <div className="mt-1 text-right text-[11px] text-ink2">
          {saved ? "Saved ✓" : "Autosaves locally"}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {canScoreAudio && (
          <button
            type="button"
            onClick={handleScoreAudio}
            disabled={busy}
            title="Gemini listens to your recording and judges tone + content"
            className="rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accentHover disabled:opacity-50"
          >
            {busy && busyKind === "audio"
              ? "Listening…"
              : active?.score
                ? "Re-score tone + content"
                : "Score tone + content"}
          </button>
        )}
        <button
          type="button"
          onClick={handleScoreText}
          disabled={busy || !canScoreText}
          title={!canScoreText ? "Write or record a transcript first" : "Score from transcript (works in Paste mode)"}
          className={`rounded-md px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            canScoreAudio
              ? "border border-line bg-surface text-ink1 hover:border-line"
              : "bg-accent text-white hover:bg-accentHover"
          }`}
        >
          {busy && busyKind === "text"
            ? "Working…"
            : canScoreAudio
              ? "Score from transcript"
              : "Coach me"}
        </button>
      </div>

      {!proxy?.reachable && canScoreAudio && (
        <p className="mt-2 text-[11px] text-ink2">
          Tone scoring needs the local API server — run{" "}
          <code className="rounded bg-surface2 px-1 text-ink1">npm run dev</code> with a{" "}
          <code className="rounded bg-surface2 px-1 text-ink1">GEMINI_API_KEY</code> in{" "}
          <code className="rounded bg-surface2 px-1 text-ink1">.env</code>. Until then, use
          transcript scoring.
        </p>
      )}
      {proxy?.reachable && !proxy?.configured && (
        <p className="mt-2 text-[11px] text-amber-400">
          API server is running but no Gemini key is set — add GEMINI_API_KEY to .env and restart.
        </p>
      )}

      {active?.score && (
        <section className="mt-6 rounded-xl border border-line bg-surface/50 p-5">
          <h3 className="mb-2 text-sm font-semibold text-accent">Analysis</h3>
          <Markdown>{active.score}</Markdown>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <p className="w-full text-[11px] text-ink2">
              Promote to the model answer on the card back (flip to see it).
            </p>
            {tightened && (
              <button
                type="button"
                onClick={() => onPromote?.(tightened)}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
              >
                Use tightened version as model
              </button>
            )}
            {transcript.trim() && (
              <button
                type="button"
                onClick={() => onPromote?.(transcript)}
                className="rounded-md border border-emerald-600/50 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-600/20 dark:text-emerald-300"
              >
                Use my draft as model
              </button>
            )}
          </div>
        </section>
      )}

      {attempts.length > 1 && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-ink1">Compare attempts</h3>
          <div className="space-y-1">
            {[...attempts].reverse().map((s, i) => {
              const n = attempts.length - i;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectAttempt(s.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition ${
                    s.id === activeId
                      ? "bg-accent/15 ring-1 ring-inset ring-accent/30"
                      : "hover:bg-surface2/60"
                  }`}
                >
                  <span className="font-medium text-ink1">#{n}</span>
                  <span className="text-ink1">{fmtDate(s.createdAt)}</span>
                  <span className="text-ink2">{fmtDuration(s.durationMs)}</span>
                  {s.confidence != null && (
                    <span className="text-ink2">{s.confidence}/5</span>
                  )}
                  {s.score ? (
                    <span className="ml-auto text-emerald-600 dark:text-emerald-400">scored</span>
                  ) : (
                    <span className="ml-auto text-ink2">unscored</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {active?.lastReviewed && (
        <p className="mt-6 text-center text-[11px] text-ink2">
          Last reviewed {new Date(active.lastReviewed).toLocaleString()}
        </p>
      )}

      <CoachPasteModal
        open={!!modal}
        title="Score my spoken answer"
        prompt={modal?.prompt || ""}
        saveLabel="Save score"
        replyHint="Paste the scoring reply here…"
        onSave={(text) => modal && applyScore(modal.attemptId, text)}
        onClose={() => setModal(null)}
      />
    </section>
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

function StopIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
