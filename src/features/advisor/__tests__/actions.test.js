import { beforeEach, describe, expect, it } from "vitest";
import {
  parseAdvisorActions,
  executeAdvisorProposal,
  stripAdvisorActions,
} from "../actions.js";
import { getDeck, resolveStageId } from "../../flashcards/deck.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";
import { addCustomCards, getDocOverride, setDocOverride } from "../../../lib/store.js";

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

describe("update_flashcards", () => {
  function setupDeck() {
    const job = createJob({
      role: "PM",
      company: "Nuro",
      stages: [
        { id: "pm_interview", title: "PM interview", subtitle: "" },
        { id: "hm", title: "Hiring Manager", subtitle: "" },
      ],
    });
    setActiveJobId(job.id);
    addCustomCards([
      {
        id: "q1",
        category: "behavioral",
        question: "Tell me about a time you identified a significant problem and drove a solution.",
      },
      {
        id: "q2",
        category: "behavioral",
        question: "Describe a situation where you had to make a recommendation with incomplete data.",
      },
    ]);
    return job;
  }

  it("parses a json fence and matches truncated questions", () => {
    setupDeck();
    const text = `Understood. I will propose these stage assignments.\n\n\`\`\`json
${JSON.stringify({
  proposals: [
    {
      type: "update_flashcards",
      label: "Assign flashcards to pm_interview stage",
      updates: [
        {
          question: "Tell me about a time you identified a significant problem...",
          stageId: "pm_interview",
        },
        {
          question: "Describe a situation where you had to make a recommendation...",
          stageId: "pm_interview",
        },
      ],
    },
  ],
})}
\`\`\``;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("update_flashcards");
    expect(proposal.updates).toHaveLength(2);
    expect(proposal.updates.map((u) => u.id)).toEqual(["q1", "q2"]);
    expect(proposal.updates[0].stageId).toBe("pm_interview");
    expect(stripAdvisorActions(text)).toBe(
      "Understood. I will propose these stage assignments."
    );
  });

  it("salvages truncated json dumps that stuffed answers into update_flashcards", () => {
    setupDeck();
    const text = `I'll regenerate the same assignments.

\`\`\`json
{
  "proposals": [
    {
      "type": "update_flashcards",
      "label": "Assign flashcards to pm_interview stage",
      "updates": [
        {
          "question": "Tell me about a time you identified a significant problem...",
          "stageId": "pm_interview",
          "referenceAnswer": "I found a gap in "eval" coverage and shipped a rubric.",
          "keyPoints": ["gap", "rubric"]
        },
        {
          "question": "Describe a situation where you had to make a recommendation...",
          "stageId": "pm_interview",
          "referenceAnswer": "I used incomplete data to
`;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("update_flashcards");
    expect(proposal.updates.map((u) => u.id)).toEqual(["q1", "q2"]);
    expect(stripAdvisorActions(text)).toBe("I'll regenerate the same assignments.");
  });

  it("applies stage assignments on confirm", () => {
    setupDeck();
    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_flashcards",
      updates: [{ question: "Tell me about a time you identified a significant problem", stageId: "pm_interview" }],
    },
  ],
})}
\`\`\``);

    const result = executeAdvisorProposal(proposal);
    expect(result.ok).toBe(true);
    expect(getDeck().find((c) => c.id === "q1").stageId).toBe("pm_interview");
  });

  it("keeps existing stage when updates only include a model answer", () => {
    setupDeck();
    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_flashcards",
      updates: [
        {
          question: "Tell me about a time you identified a significant problem",
          referenceAnswer: "I found a coverage gap and shipped a rubric.",
          keyPoints: ["gap", "rubric"],
        },
      ],
    },
  ],
})}
\`\`\``);

    expect(proposal.updates[0].stageChanged).toBe(false);
    expect(proposal.updates[0].stageId).toBeNull();
    expect(proposal.updates[0].referenceAnswer).toContain("coverage gap");

    const result = executeAdvisorProposal(proposal);
    expect(result.ok).toBe(true);
    const card = getDeck().find((c) => c.id === "q1");
    expect(card.stageId).toBeNull();
    expect(card.referenceAnswer).toContain("coverage gap");
    expect(card.keyPoints).toEqual(["gap", "rubric"]);
  });

  it("does not unassign when stageId is omitted and still applies the model answer", () => {
    setupDeck();
    const assign = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_flashcards",
      updates: [{ question: "Tell me about a time you identified a significant problem", stageId: "pm_interview" }],
    },
  ],
})}
\`\`\``)[0];
    expect(executeAdvisorProposal(assign).ok).toBe(true);
    expect(getDeck().find((c) => c.id === "q1").stageId).toBe("pm_interview");

    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_flashcards",
      updates: [
        {
          question: "Tell me about a time you identified a significant problem",
          referenceAnswer: "I found a coverage gap and shipped a rubric.",
        },
      ],
    },
  ],
})}
\`\`\``);

    expect(proposal.updates[0].stageChanged).toBe(false);
    expect(proposal.updates[0].stageId).toBe("pm_interview");
    expect(proposal.updates[0].fromStageId).toBe("pm_interview");

    const result = executeAdvisorProposal(proposal);
    expect(result.ok).toBe(true);
    const card = getDeck().find((c) => c.id === "q1");
    expect(card.stageId).toBe("pm_interview");
    expect(card.referenceAnswer).toContain("coverage gap");
  });

  it("reassigns existing cards when add_flashcards repeats a question with a stage", () => {
    setupDeck();
    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "add_flashcards",
      cards: [
        {
          category: "behavioral",
          stageId: "hm",
          question: "Tell me about a time you identified a significant problem and drove a solution.",
        },
      ],
    },
  ],
})}
\`\`\``);

    const result = executeAdvisorProposal(proposal);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Assigned 1 existing card/);
    expect(getDeck().find((c) => c.id === "q1").stageId).toBe("hm");
  });
});

describe("update_prep_doc", () => {
  it("parses replace by stage title and writes the override on confirm", () => {
    const job = createJob({});
    setActiveJobId(job.id);

    const markdown = "# Recruiter Screen\n\n- Pitch from new context.";
    const text = `short note\n\n\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_prep_doc",
      stage: "Recruiter Screen",
      mode: "replace",
      markdown,
    },
  ],
})}
\`\`\``;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("update_prep_doc");
    expect(proposal.stageId).toBe("recruiter");
    expect(proposal.mode).toBe("replace");
    expect(proposal.markdown).toBe(markdown);

    const result = executeAdvisorProposal(proposal);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("prepdoc");
    expect(getDocOverride("recruiter").markdown).toBe(markdown);
    expect(getDocOverride("recruiter").html).toContain("Pitch from new context");
  });

  it("appends to the existing override without dropping it", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    setDocOverride("recruiter", "# Existing\n\nKeep me.");

    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [
    {
      type: "update_prep_doc",
      stageId: "recruiter",
      mode: "append",
      markdown: "## New section\n\n- extra",
    },
  ],
})}
\`\`\``);

    executeAdvisorProposal(proposal);
    expect(getDocOverride("recruiter").markdown).toContain("Keep me.");
    expect(getDocOverride("recruiter").markdown).toContain("## New section");
  });

  it("promotes unknown update_prep_doc stages into add_stage proposals", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [{ type: "update_prep_doc", stageId: "coding", title: "Practical coding", markdown: "# x" }],
})}
\`\`\``);
    expect(proposal.type).toBe("add_stage");
    expect(proposal.stageId).toBe("coding");
    expect(proposal.title).toBe("Practical coding");
    expect(proposal.content).toBe("# x");
  });

  it("parses language-tagged fences and companion prep-doc markdown", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const markdown = "# Recruiter Screen\n\nPitch from portfolio.";
    const text = `Ready to update Prep Docs.\n\n\`\`\`advisor-actions json
{"proposals":[{"type":"update_prep_doc","stageId":"recruiter","mode":"replace"}]}
\`\`\`\n\n\`\`\`prep-doc
${markdown}
\`\`\``;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("update_prep_doc");
    expect(proposal.stageId).toBe("recruiter");
    expect(proposal.markdown).toBe(markdown);
    expect(stripAdvisorActions(text)).toBe("Ready to update Prep Docs.");
  });

  it("salvages a broken JSON fence when a prep-doc fence is present", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const markdown = "# Recruiter Screen\n\nSalvaged body.";
    const text = `Here it is.\n\n\`\`\`advisor-actions
{"proposals":[{"type":"update_prep_doc","stageId":"recruiter","mode":"replace","markdown":"# Recruiter with "quotes" inside"}]}
\`\`\`\n\n\`\`\`prep-doc
${markdown}
\`\`\``;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.markdown).toBe(markdown);
  });

  it("returns no proposals for malformed JSON without a prep-doc fence", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const text = `Would you like me to propose this?\n\n\`\`\`advisor-actions
{"proposals":[{"type":"update_prep_doc","stageId":"recruiter","markdown":"# Doc with "quotes"}]}
\`\`\``;
    expect(parseAdvisorActions(text)).toEqual([]);
  });

  it("attaches XML prep-doc bodies to add_stage even when they contain code fences", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const markdown = "# Practical coding\n\n```js\nfunction twoSum() {}\n```\n\nTalk through tests.";
    const text = `Rating: 9/10.\n\n\`\`\`advisor-actions
{"proposals":[{"type":"add_stage","id":"coding","title":"Practical coding","subtitle":"Virtual"}]}
\`\`\`

<prep-doc stageId="coding" title="Practical coding">
${markdown}
</prep-doc>`;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("add_stage");
    expect(proposal.stageId).toBe("coding");
    expect(proposal.content).toBe(markdown);
    expect(stripAdvisorActions(text)).toBe("Rating: 9/10.");
  });

  it("salvages XML prep-doc tags when the JSON block is malformed", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const markdown = "# System design\n\nFocus on APIs.";
    const text = `Here you go.\n\n\`\`\`advisor-actions
{"proposals":[{"type":"add_stage","title":"System design","content":"broken "quotes"}]}
\`\`\`

<prep-doc stageId="system-design" title="System design">
${markdown}
</prep-doc>`;

    const [proposal] = parseAdvisorActions(text);
    expect(proposal.type).toBe("add_stage");
    expect(proposal.title).toBe("System design");
    expect(proposal.content).toBe(markdown);
  });
});
