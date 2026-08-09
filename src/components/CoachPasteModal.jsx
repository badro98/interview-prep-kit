import { useEffect, useRef, useState } from "react";

// Paste-mode coaching flow.
//
// coach() (paste mode) hands us an assembled prompt. We show it with a "Copy" button,
// the user pastes it into Cursor chat, then pastes the model's reply back into the
// textarea. On Save, we hand the reply up via onSave so the feature can persist it.
//
// In API mode this modal is never shown — coach() returns text directly.

export default function CoachPasteModal({
  open,
  title,
  prompt,
  onSave,
  onClose,
  saveLabel = "Save",
  replyHint = "Paste the model's reply here…",
}) {
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const replyRef = useRef(null);

  useEffect(() => {
    if (open) {
      setCopied(false);
      setReply("");
    }
  }, [open, prompt]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Fallback for clipboard-blocked contexts: select the textarea content.
      const ta = document.getElementById("coach-prompt-text");
      if (ta) {
        ta.removeAttribute("readonly");
        ta.select();
        document.execCommand?.("copy");
        ta.setAttribute("readonly", "true");
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink1">{title}</h3>
            <p className="mt-0.5 text-xs text-ink2">
              Paste mode fallback — use when the proxy is off. Copy prompt, paste reply back.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-ink2 transition hover:bg-surface2 hover:text-ink1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Step 1 — copy prompt */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-ink1">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  1
                </span>
                Copy this prompt into a Cursor chat
              </h4>
              <button
                onClick={copyPrompt}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accentHover"
              >
                {copied ? "Copied ✓" : "Copy prompt"}
              </button>
            </div>
            <textarea
              id="coach-prompt-text"
              readOnly
              value={prompt}
              className="h-40 w-full resize-none rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed text-ink1 focus:border-accent focus:outline-none"
            />
          </section>

          {/* Step 2 — paste reply back */}
          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink1">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                2
              </span>
              Paste the model's reply back here
            </h4>
            <textarea
              ref={replyRef}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={replyHint}
              className="h-48 w-full resize-y rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed text-ink1 placeholder:text-ink2 focus:border-accent focus:outline-none"
            />
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-ink1 transition hover:bg-surface2"
          >
            Cancel
          </button>
          <button
            disabled={!reply.trim()}
            onClick={() => onSave?.(reply.trim())}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accentHover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
