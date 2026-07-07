// Pure step-state helpers for the onboarding wizard — no React, no storage.
// Kept separate so Onboarding.jsx stays focused on rendering/orchestration.

/** Deep copy of STAGE_PRESETS so wizard edits never mutate the config module. */
export function cloneStagePresets(presets) {
  return presets.map((s) => ({ ...s }));
}

function newStageId() {
  return `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A blank custom stage, seeded with a generic regenTask template interpolating the title. */
export function buildCustomStage(title) {
  const trimmed = title.trim() || "Custom stage";
  return {
    id: newStageId(),
    title: trimmed,
    subtitle: "",
    regenTask: `Produce a focused interview-prep doc for the "${trimmed}" stage. Cover what they're likely assessing, likely questions, the candidate's strongest stories mapped to each, talking points, and pitfalls. Use Markdown and be specific to the candidate's real experience — no generic advice.`,
  };
}

/** Move the stage at `index` up (-1) or down (+1); no-ops at the boundaries. */
export function moveStage(stages, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= stages.length) return stages;
  const next = [...stages];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
