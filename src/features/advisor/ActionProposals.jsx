import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "../../components/Markdown.jsx";
import { categoryLabel, stageLabel } from "../flashcards/deck.js";
import { getActiveJob } from "../../lib/jobs.js";

export default function ActionProposals({ proposals, appliedIds, onApply, onDismiss }) {
  const pending = proposals.filter((p) => !appliedIds.includes(p.id));
  if (pending.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-line/80 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
        Proposed changes
      </p>
      {pending.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onApply={() => onApply(p)}
          onDismiss={() => onDismiss(p.id)}
        />
      ))}
    </div>
  );
}

function reviewBody(proposal) {
  if (proposal.type === "update_prep_doc") return proposal.markdown || "";
  if (proposal.type === "add_stage" || proposal.type === "add_context") {
    return proposal.content || "";
  }
  return "";
}

function ProposalCard({ proposal, onApply, onDismiss }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const body = reviewBody(proposal);

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-200">{proposal.label}</p>

      {proposal.type === "add_flashcards" && (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-ink1">
          {proposal.cards.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-ink2">
                {categoryLabel(c.category)}
                {c.stageId
                  ? ` · ${stageLabel(c.stageId, getActiveJob()?.stages || [])}`
                  : ""}
              </span>
              <span className="min-w-0">{c.question}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.type === "update_flashcards" && (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-ink1">
          {proposal.updates.map((u, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-ink2">
                {stageLabel(u.stageId, getActiveJob()?.stages || [])}
              </span>
              <span className="min-w-0">{u.question}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.type === "add_context" && (
        <div className="mt-2 text-xs text-ink2">
          <p>
            Context title: <span className="text-ink1">{proposal.name}</span>
          </p>
          {proposal.sourceUrl && (
            <p className="mt-0.5 truncate" title={proposal.sourceUrl}>
              Source: {proposal.sourceUrl}
            </p>
          )}
          <p className="mt-1 line-clamp-3 text-ink2">{proposal.content}</p>
        </div>
      )}

      {proposal.type === "add_stage" && (
        <div className="mt-2 text-xs text-ink2">
          <p>
            Stage: <span className="text-ink1">{proposal.title}</span>
            {proposal.subtitle ? (
              <span className="text-ink2"> — {proposal.subtitle}</span>
            ) : null}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-ink2">id: {proposal.stageId}</p>
          <p className="mt-1 line-clamp-3 text-ink2">{proposal.content}</p>
        </div>
      )}

      {proposal.type === "update_prep_doc" && (
        <div className="mt-2 text-xs text-ink2">
          <p>
            {proposal.mode === "append" ? "Append to this stage’s prep doc." : "Replace this stage’s prep doc."}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-ink2">stage: {proposal.stageId}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-ink2">{proposal.markdown}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          {applyLabel(proposal.type, proposal.mode)}
        </button>
        {body ? (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink1 ring-1 ring-inset ring-line transition hover:bg-surface2"
          >
            Review
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-3 py-1.5 text-xs text-ink2 transition hover:bg-surface2 hover:text-ink1"
        >
          Dismiss
        </button>
      </div>

      {reviewOpen && (
        <ProposalReviewModal
          proposal={proposal}
          body={body}
          onClose={() => setReviewOpen(false)}
          onApply={() => {
            setReviewOpen(false);
            onApply();
          }}
          onDismiss={() => {
            setReviewOpen(false);
            onDismiss();
          }}
        />
      )}
    </div>
  );
}

function ProposalReviewModal({ proposal, body, onClose, onApply, onDismiss }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const subtitle = reviewSubtitle(proposal);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-review-title"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 id="proposal-review-title" className="text-base font-semibold text-ink1">
              {proposal.label}
            </h3>
            {subtitle ? <p className="mt-0.5 text-xs text-ink2">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-ink2 transition hover:bg-surface2 hover:text-ink1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Markdown>{body}</Markdown>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-xs text-ink2 transition hover:bg-surface2 hover:text-ink1"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink1 ring-1 ring-inset ring-line transition hover:bg-surface2"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
          >
            {applyLabel(proposal.type, proposal.mode)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function reviewSubtitle(proposal) {
  if (proposal.type === "update_prep_doc") {
    const action = proposal.mode === "append" ? "Append to" : "Replace";
    return `${action} the “${proposal.stageId}” prep doc. Scroll the full draft, then accept or dismiss.`;
  }
  if (proposal.type === "add_stage") {
    return `New stage “${proposal.title}” (${proposal.stageId}).`;
  }
  if (proposal.type === "add_context") {
    return `Save “${proposal.name}” to context.`;
  }
  return "";
}

function applyLabel(type, mode) {
  if (type === "add_flashcards") return "Add to flashcards";
  if (type === "update_flashcards") return "Update flashcards";
  if (type === "add_stage") return "Add stage + prep doc";
  if (type === "update_prep_doc") {
    return mode === "append" ? "Append to prep doc" : "Update prep doc";
  }
  return "Add to context";
}
