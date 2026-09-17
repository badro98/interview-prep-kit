import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/context.js", () => ({
  getActiveContextBlocks: vi.fn(),
}));

import { getActiveContextBlocks } from "../../../lib/context.js";
import {
  classifyContextKind,
  detectMentionedStageIds,
  detectPipelineContextSignal,
  recommendFromNewContext,
  shouldShowSuggestions,
  buildSuggestionBanner,
} from "../suggestions.js";

function setBlocks(blocks) {
  getActiveContextBlocks.mockReturnValue(blocks);
}

beforeEach(() => {
  getActiveContextBlocks.mockReset();
});

describe("classifyContextKind", () => {
  it("treats a tailored resume filename as resume, not pipeline intel", () => {
    expect(
      classifyContextKind({
        name: "Osama_Badr_Resume_Nuro",
        content: "Hiring manager at a previous role. Onsite interviews. Final round at Acme.",
      })
    ).toBe("resume");
  });

  it("treats experience/education/skills bodies as resume even without the word resume", () => {
    expect(
      classifyContextKind({
        name: "Background",
        content: "Experience\n\nLed QA at MDCalc.\n\nEducation\n\nBS CS\n\nSkills\n\nPlaywright, SQL",
      })
    ).toBe("resume");
  });

  it("classifies recruiter transcripts as pipeline", () => {
    expect(
      classifyContextKind({
        name: "Recruiter call transcript",
        content: "Next up is the hiring manager, then a take-home.",
      })
    ).toBe("pipeline");
  });
});

describe("detectMentionedStageIds", () => {
  it("picks stage shapes from recruiter notes", () => {
    expect(
      detectMentionedStageIds(
        "Next up is hiring manager, then a take-home, then onsite, then final round."
      )
    ).toEqual(["hm", "takehome", "onsite", "final"]);
  });
});

describe("detectPipelineContextSignal", () => {
  it("does not suggest on empty context", () => {
    setBlocks([]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasRecruiter).toBe(false);
    expect(signal.hasPipelinePeople).toBe(false);
    expect(signal.shouldSuggest).toBe(false);
  });

  it("detects recruiter + transcript-like labels", () => {
    setBlocks([
      {
        label: "Recruiter call transcript",
        enabled: true,
        content: "Had a screen with the recruiter about next steps.",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasRecruiter).toBe(true);
    expect(signal.transcriptLike).toBe(true);
    expect(signal.shouldSuggest).toBe(true);
  });

  it("detects generic stage-shape phrases, not people names", () => {
    setBlocks([
      {
        label: "Call notes",
        enabled: true,
        content: "Next up is hiring manager, then a panel interview, then onsite, then final round.",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.hasPipelinePeople).toBe(true);
    expect(signal.transcriptLike).toBe(true);
    expect(signal.shouldSuggest).toBe(true);
  });

  it("ignores disabled blocks", () => {
    setBlocks([
      {
        label: "Recruiter call transcript",
        enabled: false,
        content: "recruiter hiring manager pipeline screen onsite",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.shouldSuggest).toBe(false);
  });

  it("does not treat a long resume as transcript-like", () => {
    setBlocks([
      {
        label: "Osama_Badr_Resume_Nuro",
        enabled: true,
        content: `${"experience ".repeat(200)} hiring manager onsite final round`,
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.transcriptLike).toBe(false);
    expect(signal.shouldSuggest).toBe(false);
  });

  it("requires pipeline-classified notes even when stage words appear", () => {
    setBlocks([
      {
        label: "Short note",
        enabled: true,
        content: "hiring manager next",
      },
    ]);
    const signal = detectPipelineContextSignal();
    expect(signal.shouldSuggest).toBe(false);
  });
});

describe("recommendFromNewContext", () => {
  it("returns null for a resume upload", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Osama_Badr_Resume_Nuro",
          content:
            "Experience\nQA Engineer. Worked with hiring managers on onsite loops.\nEducation\nBS\nSkills\nQA",
        },
      ],
      { existingStageIds: ["recruiter"] }
    );
    expect(rec).toBeNull();
  });

  it("recommends adding named next stages from a recruiter transcript", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Recruiter call transcript",
          content: "Great chat. Next up is the hiring manager, then a take-home.",
        },
      ],
      { existingStageIds: ["recruiter"] }
    );
    expect(rec.kind).toBe("add_stages");
    expect(rec.stageIds).toEqual(["hm", "takehome"]);
    expect(rec.actionLabel).toMatch(/Add 2 stages/);
    expect(rec.title).toBe("Next rounds mentioned");
  });

  it("recommends a single add when only one stage is missing", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Call notes",
          content: "You'll meet the hiring manager next week.",
        },
      ],
      { existingStageIds: ["recruiter"] }
    );
    expect(rec.kind).toBe("add_stages");
    expect(rec.stageIds).toEqual(["hm"]);
    expect(rec.actionLabel).toBe("Add Hiring Manager");
  });

  it("recommends a refresh when mentioned stages are already on the job", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Recruiter follow-up",
          content: "The hiring manager round is confirmed for Thursday.",
        },
      ],
      { existingStageIds: ["recruiter", "hm"], currentStageId: "hm" }
    );
    expect(rec.kind).toBe("refresh_docs");
    expect(rec.stageIds).toEqual(["hm"]);
    expect(rec.actionLabel).toMatch(/Refresh/);
  });

  it("recommends refreshing from a job description", () => {
    const rec = recommendFromNewContext(
      [{ name: "Job description", content: "We're hiring a QA engineer for AI products." }],
      { existingStageIds: ["recruiter"], currentStageId: "recruiter" }
    );
    expect(rec.kind).toBe("refresh_docs");
    expect(rec.stageIds).toEqual(["recruiter"]);
    expect(rec.title).toBe("Job description saved");
  });

  it("does not treat a recruiter filename as the mentioned next stage", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Recruiter call transcript",
          content: "Great chat. Next up is the hiring manager, then a take-home.",
        },
      ],
      { existingStageIds: ["recruiter", "hm", "takehome", "onsite", "final"], currentStageId: "recruiter" }
    );
    expect(rec.kind).toBe("refresh_docs");
    expect(rec.stageIds).toEqual(["hm"]);
  });

  it("does not re-add dismissed stages", () => {
    const rec = recommendFromNewContext(
      [
        {
          name: "Recruiter call transcript",
          content: "Next up is the hiring manager.",
        },
      ],
      { existingStageIds: ["recruiter"], dismissedIds: ["hm"] }
    );
    expect(rec).toBeNull();
  });
});

describe("shouldShowSuggestions / buildSuggestionBanner", () => {
  it("does not toast just because seed stages are missing", () => {
    expect(shouldShowSuggestions(null, [{ id: "hm", title: "Hiring Manager" }])).toBe(false);
    expect(buildSuggestionBanner(null, [{ id: "hm", title: "Hiring Manager" }])).toEqual(
      expect.objectContaining({ title: "Hiring Manager is ready to add" })
    );
    expect(shouldShowSuggestions(null, [])).toBe(false);
  });

  it("toasts only when a recommendation is actionable", () => {
    const rec = {
      kind: "add_stages",
      stageIds: ["hm"],
      eyebrow: "New context",
      title: "Hiring Manager is next",
      body: "Add it?",
      actionLabel: "Add Hiring Manager",
    };
    expect(shouldShowSuggestions(rec, [{ id: "hm", title: "Hiring Manager" }])).toBe(true);
    expect(buildSuggestionBanner(rec)).toEqual(
      expect.objectContaining({
        title: "Hiring Manager is next",
        actionLabel: "Add Hiring Manager",
      })
    );
  });
});
