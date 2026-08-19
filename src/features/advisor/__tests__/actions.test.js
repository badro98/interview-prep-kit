import { beforeEach, describe, expect, it } from "vitest";
import {
  parseAdvisorActions,
  executeAdvisorProposal,
  stripAdvisorActions,
} from "../actions.js";
import { resolveStageId } from "../../flashcards/deck.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";
import { getDocOverride, setDocOverride } from "../../../lib/store.js";

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

  it("drops proposals for unknown stages", () => {
    const job = createJob({});
    setActiveJobId(job.id);
    const [proposal] = parseAdvisorActions(`\`\`\`advisor-actions
${JSON.stringify({
  proposals: [{ type: "update_prep_doc", stageId: "nope", markdown: "# x" }],
})}
\`\`\``);
    expect(proposal).toBeUndefined();
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
});
