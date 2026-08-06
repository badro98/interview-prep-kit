import { categoryLabel } from "../flashcards/deck.js";

export default function ActionProposals({ proposals, appliedIds, onApply, onDismiss }) {
  const pending = proposals.filter((p) => !appliedIds.includes(p.id));
  if (pending.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-ink-600/80 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-400">
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

function ProposalCard({ proposal, onApply, onDismiss }) {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-sm font-medium text-emerald-200">{proposal.label}</p>

      {proposal.type === "add_flashcards" && (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-slate-300">
          {proposal.cards.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-slate-500">
                {categoryLabel(c.category)}
              </span>
              <span className="min-w-0">{c.question}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.type === "add_context" && (
        <div className="mt-2 text-xs text-slate-400">
          <p>
            Context title: <span className="text-slate-300">{proposal.name}</span>
          </p>
          {proposal.sourceUrl && (
            <p className="mt-0.5 truncate" title={proposal.sourceUrl}>
              Source: {proposal.sourceUrl}
            </p>
          )}
          <p className="mt-1 line-clamp-3 text-slate-500">{proposal.content}</p>
        </div>
      )}

      {proposal.type === "add_stage" && (
        <div className="mt-2 text-xs text-slate-400">
          <p>
            Stage: <span className="text-slate-300">{proposal.title}</span>
            {proposal.subtitle ? (
              <span className="text-slate-500"> — {proposal.subtitle}</span>
            ) : null}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">id: {proposal.stageId}</p>
          <p className="mt-1 line-clamp-3 text-slate-500">{proposal.content}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          {proposal.type === "add_flashcards"
            ? "Add to flashcards"
            : proposal.type === "add_stage"
              ? "Add stage + prep doc"
              : "Add to context"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-3 py-1.5 text-xs text-slate-400 transition hover:bg-ink-700 hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
