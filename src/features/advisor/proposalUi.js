/** Kit actions that render a Confirm card from an `advisor-actions` fence. */
export const KIT_PROPOSAL_TYPES = [
  "add_flashcards",
  "update_flashcards",
  "add_context",
  "add_stage",
  "add_subpage",
  "update_prep_doc",
];

/**
 * Confirm-card lifecycle for every kit action:
 *   pending   → Apply / Dismiss / Review
 *   applied   → Review only (recap; no second write)
 *   dismissed → hide
 */
export function isFlashcardProposal(proposal) {
  return proposal?.type === "add_flashcards" || proposal?.type === "update_flashcards";
}

export function flashcardItems(proposal) {
  if (proposal?.type === "add_flashcards") return [...(proposal.cards || [])];
  if (proposal?.type === "update_flashcards") return [...(proposal.updates || [])];
  return [];
}

export function itemKey(item, i) {
  return `${i}:${(item.question || "").trim()}`;
}

export function isProposalVisible(proposal, { appliedIds = [], dismissedIds = [] } = {}) {
  if (!proposal?.id) return true;
  if (dismissedIds.includes(proposal.id) && !appliedIds.includes(proposal.id)) return false;
  return true;
}

export function isProposalComplete(proposal, { applied = false, itemStatus = {} } = {}) {
  if (applied) return true;
  if (!isFlashcardProposal(proposal)) return false;
  const items = flashcardItems(proposal);
  return items.length > 0 && items.every((item, i) => itemStatus[itemKey(item, i)]);
}

export function appliedSummary(proposal) {
  if (!proposal) return "Applied.";
  if (proposal.type === "update_prep_doc") {
    return proposal.mode === "append" ? "Appended to the prep doc." : "Prep doc updated.";
  }
  if (proposal.type === "add_stage") return "Stage added.";
  if (proposal.type === "add_subpage") return "Subpage added.";
  if (proposal.type === "add_context") return "Saved to context.";
  if (proposal.type === "update_flashcards") return "Flashcards updated.";
  if (proposal.type === "add_flashcards") return "Flashcards added.";
  return "Applied.";
}
