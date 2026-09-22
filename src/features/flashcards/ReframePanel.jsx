import { useEffect, useState } from "react";
import { getActiveContextBlocks } from "../../lib/context.js";
import { coach, MODE_PASTE } from "../../lib/coach.js";
import { getActiveJobId } from "../../lib/jobs.js";
import { buildReframeTask, formatModelAnswerText, parseReframedModel } from "./deck.js";

const PARSE_ERROR = "Couldn't read a model answer from that reply.";

export default function ReframePanel({
  card,
  open,
  onAccept,
  onRequestPaste,
  pasteReply,
  onPasteReplyConsumed,
}) {
  const [instruction, setInstruction] = useState("");
  const [pinnedIds, setPinnedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawReply, setRawReply] = useState("");
  const [draft, setDraft] = useState(null);

  const blocks = getActiveContextBlocks().filter((b) => b.enabled && b.content?.trim());

  useEffect(() => {
    if (open) return;
    setInstruction("");
    setPinnedIds(new Set());
    setBusy(false);
    setError("");
    setRawReply("");
    setDraft(null);
  }, [open]);

  useEffect(() => {
    if (!open || !pasteReply?.text) return;
    applyReply(pasteReply.text);
    onPasteReplyConsumed?.();
  }, [open, pasteReply]);

  if (!open) return null;

  function pinnedSources() {
    return blocks
      .filter((b) => pinnedIds.has(b.name))
      .map((b) => ({ label: b.label, content: b.content }));
  }

  function applyReply(text) {
    const parsed = parseReframedModel(text);
    if (!parsed) {
      setDraft(null);
      setRawReply(String(text || ""));
      setError(PARSE_ERROR);
      return;
    }
    setError("");
    setRawReply("");
    setDraft(parsed);
  }

  function togglePin(id) {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function rewrite() {
    const text = instruction.trim();
    if (!text || busy) return;
    setError("");
    setRawReply("");
    setDraft(null);
    setBusy(true);
    const jobId = getActiveJobId();
    try {
      const task = buildReframeTask({
        question: card.question,
        referenceAnswer: card.referenceAnswer,
        keyPoints: card.keyPoints,
        instruction: text,
        pinnedSources: pinnedSources(),
      });
      const result = await coach({ task, includeContext: true });
      if (jobId !== getActiveJobId()) return;
      if (result.mode === MODE_PASTE) {
        onRequestPaste?.({
          title: "Rewrite model answer",
          prompt: result.prompt,
          saveLabel: "Use this reply",
          replyHint: 'Paste the JSON object { "referenceAnswer", "keyPoints" } here…',
        });
      } else {
        applyReply(result.text);
      }
    } catch (e) {
      if (jobId !== getActiveJobId()) return;
      setError(e.message || "Rewrite failed.");
    } finally {
      if (jobId === getActiveJobId()) setBusy(false);
    }
  }

  const currentDisplay =
    formatModelAnswerText(card.referenceAnswer, card.keyPoints) || "No model answer yet.";
  const draftDisplay = draft
    ? formatModelAnswerText(draft.referenceAnswer, draft.keyPoints)
    : "";

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink1">Rewrite model answer</h3>
        <p className="text-[11px] text-ink2">Nothing is saved until you accept a draft.</p>
      </div>

      <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink2">
        Instruction
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Keep this story, but frame it the way the recruiter transcript said."
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-line bg-canvas p-3 text-sm leading-relaxed text-ink1 focus:border-accent focus:outline-none"
        />
      </label>

      {blocks.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink2">
            Point at sources
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {blocks.map((block) => {
              const pinned = pinnedIds.has(block.name);
              const kind = block.source === "profile" ? "shared" : "this job";
              return (
                <button
                  key={block.name}
                  type="button"
                  aria-pressed={pinned}
                  onClick={() => togglePin(block.name)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    pinned
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line bg-canvas text-ink1 hover:border-accent/40"
                  }`}
                >
                  {block.label}
                  <span className="ml-1 font-normal text-ink2">{kind}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={rewrite}
          disabled={!instruction.trim() || busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accentHover disabled:opacity-40"
        >
          {busy ? "Rewriting…" : draft ? "Rewrite again" : "Rewrite"}
        </button>
        {draft && (
          <>
            <button
              type="button"
              onClick={() =>
                onAccept?.({
                  referenceAnswer: draft.referenceAnswer,
                  keyPoints: draft.keyPoints,
                  instruction: instruction.trim(),
                })
              }
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError("");
                setRawReply("");
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-surface2 hover:text-ink1"
            >
              Discard
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
      {rawReply && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 font-sans text-xs leading-relaxed text-ink2">
          {rawReply}
        </pre>
      )}

      {draft && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-canvas/60 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink2">
              Current
            </p>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink1">
              {currentDisplay}
            </pre>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              Draft
            </p>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink1">
              {draftDisplay}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
