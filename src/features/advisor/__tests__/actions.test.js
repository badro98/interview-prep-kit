import { beforeEach, describe, expect, it } from "vitest";
import { parseAdvisorActions } from "../actions.js";
import { resolveStageId } from "../../flashcards/deck.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";

beforeEach(() => {
  localStorage.clear();
});

describe("resolveStageId", () => {
  const stages = [
    { id: "takehome", title: "Take-home" },
    { id: "hm", title: "Hiring Manager" },
  ];

  it("matches ids and titles", () => {
    expect(resolveStageId("takehome", stages)).toBe("takehome");
    expect(resolveStageId("Take-home", stages)).toBe("takehome");
    expect(resolveStageId("nope", stages)).toBeNull();
  });
});

describe("parseAdvisorActions — flashcard stageId", () => {
  it("attaches a resolved stageId onto proposed cards", () => {
    const job = createJob({
      role: "Eng",
      company: "Acme",
      stages: [
        { id: "takehome", title: "Take-home", subtitle: "" },
        { id: "hm", title: "Hiring Manager", subtitle: "" },
      ],
    });
    setActiveJobId(job.id);

    const text = `ok\n\n\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "add_flashcards",
      cards: [
        {
          category: "behavioral",
          stageId: "takehome",
          question: "Walk me through the prompt.",
        },
        {
          category: "situational",
          stage: "Hiring Manager",
          question: "Tell me about a conflict.",
        },
      ],
    },
  ],
})}
\`\`\``;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.cards[0].stageId).toBe("takehome");
    expect(proposal.cards[1].stageId).toBe("hm");
  });
});
