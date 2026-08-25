import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "../../components/Markdown.jsx";
import { categoryLabel, stageLabel } from "../flashcards/deck.js";
import { getActiveJob } from "../../lib/jobs.js";
import { normalizePrepMarkdown } from "../../lib/markdownHtml.js";
import {
  appliedSummary,
  flashcardItems,
  isFlashcardProposal,
  isProposalComplete,
  isProposalVisible,
  itemKey,
} from "./proposalUi.js";

// Confirm cards (every kit action): pending → Apply/Dismiss/Review;
// applied → Review only; dismissed → hidden. See proposalUi.js.

export default function ActionProposals({
  proposals,
  appliedIds = [],
  dismissedIds = [],
  itemStatus = {},
  onApply,
  onDismiss,
  onRecordStatus,
}) {
  const visible = proposals.filter((p) =>
    isProposalVisible(p, { appliedIds, dismissedIds })
  );
  if (visible.length === 0) return null;

  const anyPending = visible.some(
    (p) =>
      !isProposalComplete(p, {
        applied: appliedIds.includes(p.id),
        itemStatus: itemStatus[p.id] || {},
      })
  );

  return (
    <div className="mt-3 space-y-2 border-t border-line/80 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
        {anyPending ? "Proposed changes" : "Changes"}
      </p>
      {visible.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          applied={appliedIds.includes(p.id)}
          itemStatus={itemStatus[p.id] || {}}
          onApply={(next, opts) => onApply(next ?? p, opts)}
          onDismiss={() => onDismiss(p.id)}
          onRecordStatus={(updates, summary) => onRecordStatus?.(p.id, updates, summary)}
        />
      ))}
    </div>
  );
}

function reviewBody(proposal) {
  if (proposal.type === "update_prep_doc" || proposal.type === "add_subpage") {
    return normalizePrepMarkdown(proposal.markdown || "");
  }
  if (proposal.type === "add_stage" || proposal.type === "add_context") {
    return normalizePrepMarkdown(proposal.content || "");
  }
  return "";
}

function subsetProposal(proposal, items) {
  if (proposal.type === "add_flashcards") return { ...proposal, cards: items };
  if (proposal.type === "update_flashcards") return { ...proposal, updates: items };
  return proposal;
}

function ProposalCard({
  proposal,
  applied = false,
  itemStatus,
  onApply,
  onDismiss,
  onRecordStatus,
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const body = reviewBody(proposal);
  const canReview = Boolean(body) || isFlashcardProposal(proposal);
  const stages = getActiveJob()?.stages || [];
  const flashcards = isFlashcardProposal(proposal);
  const blocked = Boolean(proposal.blockedReason);
  const items = flashcardItems(proposal);
  const remaining = items.filter((item, i) => !itemStatus[itemKey(item, i)]);
  const complete = isProposalComplete(proposal, { applied, itemStatus });

  function applyItems(nextItems, { keepOpen, quiet } = {}) {
    if (!nextItems.length) return;
    onApply(subsetProposal(proposal, nextItems), { keepOpen, quiet });
  }

  function mergedStatus(updates) {
    return { ...itemStatus, ...updates };
  }

  function approveOne(item, i) {
    const updates = { [itemKey(item, i)]: "approved" };
    const left = remaining.length - 1;
    onRecordStatus(
      updates,
      left === 0 ? statusSummary(proposal.type, items, mergedStatus(updates)) : undefined
    );
    applyItems([item], { keepOpen: true });
  }

  function skipOne(item, i) {
    const updates = { [itemKey(item, i)]: "skipped" };
    onRecordStatus(
      updates,
      remaining.length - 1 === 0
        ? statusSummary(proposal.type, items, mergedStatus(updates))
        : undefined
    );
  }

  function skipRemaining() {
    const updates = {};
    remaining.forEach((item, idx) => {
      const i = items.indexOf(item);
      updates[itemKey(item, i === -1 ? idx : i)] = "skipped";
    });
    onRecordStatus(updates, statusSummary(proposal.type, items, mergedStatus(updates)));
  }

  function applyRemaining() {
    if (complete || proposal.blockedReason) return;
    if (flashcards) {
      if (!remaining.length) return;
      const updates = {};
      remaining.forEach((item, idx) => {
        const i = items.indexOf(item);
        updates[itemKey(item, i === -1 ? idx : i)] = "approved";
      });
      onRecordStatus(updates, statusSummary(proposal.type, items, mergedStatus(updates)));
      applyItems(remaining, { keepOpen: true });
      return;
    }
    onApply(proposal);
  }

  return (
    <div
      className={`rounded-lg border p-3 ${
        complete
          ? "border-line bg-surface2/40"
          : blocked
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-emerald-500/30 bg-emerald-500/5"
      }`}
    >
      <p
        className={`text-sm font-medium ${
          complete
            ? "text-ink1"
            : blocked
              ? "text-amber-800 dark:text-amber-200"
              : "text-emerald-700 dark:text-emerald-200"
        }`}
      >
        {proposal.label}
      </p>
      {blocked ? (
        <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          {proposal.blockedReason}
        </p>
      ) : null}
      {complete ? (
        <p className="mt-0.5 text-xs text-ink2">
          {flashcards ? statusSummary(proposal.type, items, itemStatus) : appliedSummary(proposal)}
        </p>
      ) : null}

      {flashcards && (
        <FlashcardStatusList
          items={items}
          statusMap={itemStatus}
          stages={stages}
          approvedLabel={approvedLabel(proposal.type)}
        />
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

      {proposal.type === "add_subpage" && (
        <div className="mt-2 text-xs text-ink2">
          <p>
            New subpage under {stageTitle(proposal)}:{" "}
            <span className="text-ink1">{proposal.title}</span>
          </p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-ink2">{proposal.markdown}</p>
        </div>
      )}

      {proposal.type === "update_prep_doc" && (
        <div className="mt-2 text-xs text-ink2">
          <p>
            {blocked
              ? "This is not a prep-doc change."
              : proposal.mode === "append"
                ? `Append to the ${stageTitle(proposal)} prep doc.`
                : `Replace the ${stageTitle(proposal)} prep doc.`}
          </p>
          {!blocked ? (
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-ink2">{proposal.markdown}</p>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canReview ? (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className={
              complete || !flashcards
                ? "rounded-md px-3 py-1.5 text-xs font-medium text-ink1 ring-1 ring-inset ring-line transition hover:bg-surface2"
                : "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            }
          >
            Review
          </button>
        ) : null}
        {!complete ? (
          <>
            {!blocked ? (
              <button
                type="button"
                onClick={applyRemaining}
                className={
                  flashcards
                    ? "rounded-md px-3 py-1.5 text-xs font-medium text-ink1 ring-1 ring-inset ring-line transition hover:bg-surface2"
                    : "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                }
              >
                {applyLabel(proposal.type, proposal.mode, flashcards ? remaining.length : undefined)}
              </button>
            ) : null}
            <button
              type="button"
              onClick={flashcards ? skipRemaining : onDismiss}
              className="rounded-md px-3 py-1.5 text-xs text-ink2 transition hover:bg-surface2 hover:text-ink1"
            >
              Dismiss
            </button>
          </>
        ) : null}
      </div>

      {reviewOpen && (
        <ProposalReviewModal
          proposal={proposal}
          body={body}
          items={flashcards ? items : remaining}
          remaining={remaining}
          itemStatus={itemStatus}
          complete={complete}
          onClose={() => setReviewOpen(false)}
          onApprove={approveOne}
          onSkip={skipOne}
          onApplyRemaining={applyRemaining}
          onDismiss={() => {
            if (flashcards) skipRemaining();
            else {
              setReviewOpen(false);
              onDismiss();
            }
          }}
        />
      )}
    </div>
  );
}

function FlashcardStatusList({ items, statusMap, stages, approvedLabel }) {
  if (!items.length) {
    return <p className="mt-2 text-xs text-ink2">No flashcards in this proposal.</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item, i) => {
        const status = statusMap[itemKey(item, i)];
        return (
          <li key={itemKey(item, i)} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className={`text-sm leading-snug ${
                  status === "skipped" ? "text-ink2 line-through" : "text-ink1"
                }`}
              >
                {item.question}
              </p>
              <p className="mt-0.5 text-[11px] text-ink2">{flashcardMeta(item, stages)}</p>
            </div>
            {status ? <StatusPill status={status} approvedLabel={approvedLabel} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function StatusPill({ status, approvedLabel }) {
  if (status === "approved") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        {approvedLabel}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink2">
      Skipped
    </span>
  );
}

function flashcardMeta(item, stages) {
  const cat = categoryLabel(item.category);
  const fromCat =
    item.fromCategory && item.fromCategory !== item.category
      ? `${categoryLabel(item.fromCategory)} → `
      : "";
  const stage = stageLabel(item.stageId, stages);
  const fromStage =
    item.fromStageId !== undefined && item.fromStageId !== item.stageId
      ? `${stageLabel(item.fromStageId, stages)} → `
      : "";
  return `${fromCat}${cat} · ${fromStage}${stage}`;
}

function ProposalReviewModal({
  proposal,
  body,
  items,
  remaining,
  itemStatus,
  complete,
  onClose,
  onApprove,
  onSkip,
  onApplyRemaining,
  onDismiss,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flashcards = isFlashcardProposal(proposal);
  const subtitle = flashcards
    ? complete
      ? statusSummary(proposal.type, items, itemStatus)
      : remaining.length === 1
        ? "Approve this card, or skip it."
        : `${remaining.length} cards left — approve each one, or apply the rest.`
    : complete
      ? appliedSummary(proposal)
      : reviewSubtitle(proposal);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-review-title"
    >
      <div
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl ${
          flashcards ? "max-w-2xl" : "max-w-3xl"
        }`}
      >
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

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto px-5 py-4">
          {flashcards ? (
            <FlashcardReviewList
              items={items}
              itemStatus={itemStatus}
              approvedLabel={approvedLabel(proposal.type)}
              onApprove={onApprove}
              onSkip={onSkip}
            />
          ) : (
            <div className="min-w-0">
              <Markdown>{body}</Markdown>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {!complete ? (
            <button
              type="button"
              onClick={onDismiss}
              className="mr-auto rounded-md px-3 py-1.5 text-xs text-ink2 transition hover:bg-surface2 hover:text-ink1"
            >
              {flashcards ? "Dismiss remaining" : "Dismiss"}
            </button>
          ) : (
            <span className="mr-auto" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink1 ring-1 ring-inset ring-line transition hover:bg-surface2"
          >
            Close
          </button>
          {!complete && flashcards && remaining.length > 1 ? (
            <button
              type="button"
              onClick={onApplyRemaining}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              {applyLabel(proposal.type, proposal.mode, remaining.length)}
            </button>
          ) : !complete && !flashcards && !proposal.blockedReason ? (
            <button
              type="button"
              onClick={onApplyRemaining}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              {applyLabel(proposal.type, proposal.mode)}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function stageTitle(proposal) {
  const stages = getActiveJob()?.stages || [];
  return stages.find((s) => s.id === proposal.stageId)?.title || proposal.stageId || "this stage";
}

function reviewSubtitle(proposal) {
  if (proposal.blockedReason) return proposal.blockedReason;
  if (proposal.type === "update_prep_doc") {
    const action = proposal.mode === "append" ? "Append to" : "Replace";
    return `${action} the ${stageTitle(proposal)} prep doc. Scroll the full draft, then accept or dismiss.`;
  }
  if (proposal.type === "add_stage") {
    return `New stage “${proposal.title}” (${proposal.stageId}).`;
  }
  if (proposal.type === "add_subpage") {
    return `New subpage “${proposal.title}” under ${stageTitle(proposal)}. Scroll the draft, then accept or dismiss.`;
  }
  if (proposal.type === "add_context") {
    return `Save “${proposal.name}” to context.`;
  }
  return "";
}

function FlashcardReviewList({ items, itemStatus, approvedLabel, onApprove, onSkip }) {
  const stages = getActiveJob()?.stages || [];
  if (!items.length) {
    return <p className="text-sm text-ink2">No flashcards in this proposal.</p>;
  }
  return (
    <ol className="space-y-4">
      {items.map((item, i) => {
        const status = itemStatus[itemKey(item, i)];
        return (
          <li
            key={itemKey(item, i)}
            className={`rounded-lg border p-4 ${
              status === "skipped"
                ? "border-line bg-canvas/20 opacity-70"
                : status === "approved"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-line bg-canvas/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink2">
                {i + 1} of {items.length}
              </p>
              {status ? <StatusPill status={status} approvedLabel={approvedLabel} /> : null}
            </div>
            <p
              className={`mt-1 text-sm font-medium leading-snug ${
                status === "skipped" ? "text-ink2 line-through" : "text-ink1"
              }`}
            >
              {item.question}
            </p>
            <p className="mt-1.5 text-xs text-ink2">{flashcardMeta(item, stages)}</p>
            {item.referenceAnswer ? (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink2">
                  Model answer
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink1">
                  {item.referenceAnswer}
                </p>
              </div>
            ) : null}
            {Array.isArray(item.keyPoints) && item.keyPoints.length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink2">
                  Key points
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink1">
                  {item.keyPoints.map((pt, j) => (
                    <li key={j}>{pt}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!item.referenceAnswer && !(item.keyPoints && item.keyPoints.length) ? (
              <p className="mt-3 text-xs text-ink2">No model answer in this proposal.</p>
            ) : null}
            {!status ? (
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onSkip(item, i)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-ink2 transition hover:bg-surface2 hover:text-ink1"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(item, i)}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  Approve
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function approvedLabel(type) {
  return type === "update_flashcards" ? "Updated" : "Added";
}

function statusSummary(type, items, statusMap) {
  let added = 0;
  let skipped = 0;
  items.forEach((item, i) => {
    const status = statusMap[itemKey(item, i)];
    if (status === "approved") added += 1;
    if (status === "skipped") skipped += 1;
  });
  const verb = approvedLabel(type);
  const parts = [];
  if (added) parts.push(`${verb} ${added}`);
  if (skipped) parts.push(`skipped ${skipped}`);
  return parts.join(" · ") || "Done";
}

function applyLabel(type, mode, count) {
  const n = typeof count === "number" ? count : null;
  const suffix = n != null && n !== 1 ? ` (${n})` : "";
  if (type === "add_flashcards") return n === 1 ? "Add this card" : `Add all${suffix}`;
  if (type === "update_flashcards") return n === 1 ? "Update this card" : `Update all${suffix}`;
  if (type === "add_stage") return "Add stage + prep doc";
  if (type === "add_subpage") return "Add subpage";
  if (type === "update_prep_doc") {
    return mode === "append" ? "Append to prep doc" : "Update prep doc";
  }
  return "Add to context";
}
