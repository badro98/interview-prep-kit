import { describe, expect, it } from "vitest";
import {
  KIT_PROPOSAL_TYPES,
  appliedSummary,
  isProposalComplete,
  isProposalVisible,
} from "../proposalUi.js";

describe("Confirm-card lifecycle", () => {
  it("covers every kit action type the parser emits", () => {
    expect(KIT_PROPOSAL_TYPES).toEqual([
      "add_flashcards",
      "update_flashcards",
      "add_context",
      "add_stage",
      "add_subpage",
      "update_prep_doc",
    ]);
  });

  it.each(KIT_PROPOSAL_TYPES)(
    "keeps %s visible after apply so Review still works",
    (type) => {
      const proposal = { id: "p1", type };
      expect(
        isProposalVisible(proposal, { appliedIds: ["p1"], dismissedIds: [] })
      ).toBe(true);
      expect(isProposalComplete(proposal, { applied: true })).toBe(true);
    }
  );

  it.each(KIT_PROPOSAL_TYPES)("hides %s after dismiss", (type) => {
    const proposal = { id: "p1", type };
    expect(
      isProposalVisible(proposal, { appliedIds: [], dismissedIds: ["p1"] })
    ).toBe(false);
  });

  it("does not treat a pending doc/stage/context card as complete", () => {
    for (const type of ["add_context", "add_stage", "add_subpage", "update_prep_doc"]) {
      expect(isProposalComplete({ id: "p1", type }, { applied: false })).toBe(false);
    }
  });

  it("treats flashcards as complete when every item has a status", () => {
    const proposal = {
      id: "p1",
      type: "add_flashcards",
      cards: [{ question: "Q1" }, { question: "Q2" }],
    };
    expect(
      isProposalComplete(proposal, {
        applied: false,
        itemStatus: { "0:Q1": "approved", "1:Q2": "skipped" },
      })
    ).toBe(true);
    expect(
      isProposalComplete(proposal, {
        applied: false,
        itemStatus: { "0:Q1": "approved" },
      })
    ).toBe(false);
  });
});

describe("appliedSummary", () => {
  it("names the write that already happened", () => {
    expect(appliedSummary({ type: "update_prep_doc" })).toBe("Prep doc updated.");
    expect(appliedSummary({ type: "update_prep_doc", mode: "append" })).toBe(
      "Appended to the prep doc."
    );
    expect(appliedSummary({ type: "add_stage" })).toBe("Stage added.");
    expect(appliedSummary({ type: "add_subpage" })).toBe("Subpage added.");
    expect(appliedSummary({ type: "add_context" })).toBe("Saved to context.");
  });
});
