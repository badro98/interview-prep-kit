import { describe, expect, it } from "vitest";
import { buildReframeTask, parseReframedModel } from "../deck.js";

const base = {
  question: "Tell me about a time you influenced without authority.",
  referenceAnswer: "I used the growth experiment at Acme to align the team.",
  keyPoints: ["clear situation", "measurable result"],
};

describe("buildReframeTask", () => {
  it("includes the instruction and the current model answer", () => {
    const task = buildReframeTask({
      ...base,
      instruction: "Use the billing-migration story instead.",
      pinnedSources: [],
    });

    expect(task).toContain("Use the billing-migration story instead.");
    expect(task).toContain(base.question);
    expect(task).toContain(base.referenceAnswer);
    expect(task).toContain("- clear situation");
    expect(task).toContain("- measurable result");
  });

  it("inlines pinned source labels and content", () => {
    const task = buildReframeTask({
      ...base,
      instruction: "Update this the way the recruiter mentioned.",
      pinnedSources: [
        {
          label: "Recruiter transcript",
          content: "Lead with the stakeholder conflict, then the metric.",
        },
      ],
    });

    expect(task).toContain("Sources the user pointed at:");
    expect(task).toContain("Recruiter transcript");
    expect(task).toContain("Lead with the stakeholder conflict, then the metric.");
  });

  it("tells a framing change to keep the anecdote instead of swapping stories", () => {
    const task = buildReframeTask({
      ...base,
      instruction:
        "Keep the checkout migration, but lead with the stakeholder conflict.",
      pinnedSources: [],
    });

    expect(task).toContain(
      "Keep the checkout migration, but lead with the stakeholder conflict."
    );
    expect(task).toContain("A framing change keeps the same anecdote.");
    expect(task).toContain(
      "Do not swap stories unless the instruction asks for a different story."
    );
    expect(task).not.toContain("Replace the current story");
  });
});

describe("parseReframedModel", () => {
  it("accepts fenced JSON", () => {
    const parsed = parseReframedModel(
      "```json\n" +
        JSON.stringify({
          referenceAnswer: "Lead with the conflict, then the 12% lift.",
          keyPoints: ["conflict", "metric"],
        }) +
        "\n```"
    );
    expect(parsed).toEqual({
      referenceAnswer: "Lead with the conflict, then the 12% lift.",
      keyPoints: ["conflict", "metric"],
    });
  });

  it("accepts an empty key-point list", () => {
    expect(
      parseReframedModel('{"referenceAnswer":"Just the story.","keyPoints":[]}')
    ).toEqual({
      referenceAnswer: "Just the story.",
      keyPoints: [],
    });
  });

  it("rejects prose and an empty answer", () => {
    expect(parseReframedModel("Here is a better story about checkout.")).toBeNull();
    expect(
      parseReframedModel('{"referenceAnswer":"   ","keyPoints":["kept"]}')
    ).toBeNull();
    expect(
      parseReframedModel('{"referenceAnswer":"Kept","keyPoints":"not-an-array"}')
    ).toBeNull();
  });
});
