import { useRef, useState } from "react";
import { buildCustomStage, moveStage } from "../features/onboarding/steps.js";

/**
 * Controlled stage-list editor shared by the onboarding wizard and Job
 * Settings — one implementation for rename/reorder/remove/add plus an
 * "Advanced" disclosure for editing a stage's regen prompt (regenTask).
 * `stages` in, `onChange(nextStages)` out; no internal stage state.
 */
export default function StageEditor({ stages, onChange }) {
  // Monotonic counter for default custom-stage labels — prev.length + 1 would
  // duplicate labels after a remove-then-add (e.g. add "Custom stage 2", remove
  // it, add again → prev.length + 1 collides with an existing stage).
  const customStageCountRef = useRef(0);
  const [expanded, setExpanded] = useState(() => new Set());

  function renameStage(id, patch) {
    onChange(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeStage(id) {
    onChange(stages.filter((s) => s.id !== id));
  }
  function addStage() {
    customStageCountRef.current += 1;
    onChange([...stages, buildCustomStage(`Custom stage ${customStageCountRef.current}`)]);
  }
  function moveStageAt(index, direction) {
    onChange(moveStage(stages, index, direction));
  }
  function toggleAdvanced(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const isOpen = expanded.has(stage.id);
          return (
            <div key={stage.id} className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
              <div className="flex items-start gap-2">
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    onClick={() => moveStageAt(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-ink-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveStageAt(i, 1)}
                    disabled={i === stages.length - 1}
                    aria-label="Move down"
                    className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-ink-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    value={stage.title}
                    onChange={(e) => renameStage(stage.id, { title: e.target.value })}
                    placeholder="Stage title"
                    className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm font-medium text-slate-200 focus:border-accent-500 focus:outline-none"
                  />
                  <input
                    value={stage.subtitle || ""}
                    onChange={(e) => renameStage(stage.id, { subtitle: e.target.value })}
                    placeholder="Subtitle (optional)"
                    className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-slate-400 focus:border-accent-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => removeStage(stage.id)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-ink-600 hover:text-red-400"
                >
                  Remove
                </button>
              </div>

              <div className="mt-2">
                <button
                  onClick={() => toggleAdvanced(stage.id)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-300"
                >
                  {isOpen ? "▾ Advanced" : "▸ Advanced"}
                </button>
                {isOpen && (
                  <textarea
                    value={stage.regenTask || ""}
                    onChange={(e) => renameStage(stage.id, { regenTask: e.target.value })}
                    rows={5}
                    placeholder="AI prompt used when regenerating this stage's prep doc."
                    className="mt-1.5 w-full resize-none rounded-md border border-ink-600 bg-ink-900 p-2 font-mono text-xs leading-relaxed text-slate-200 focus:border-accent-500 focus:outline-none"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={addStage}
        className="mt-3 w-full rounded-xl border border-dashed border-ink-600 py-2.5 text-xs text-slate-400 transition hover:border-ink-500 hover:text-white"
      >
        + Add custom stage
      </button>
    </div>
  );
}
