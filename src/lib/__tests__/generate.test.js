import { beforeEach, describe, expect, it, vi } from "vitest";
import { coach } from "../coach.js";
import { getDocOverride } from "../store.js";
import { createJob, setActiveJobId } from "../jobs.js";
import {
  generateStageDoc,
  saveStageDoc,
  buildFlashcardsTask,
  parseFlashcards,
  generateFlashcards,
} from "../generate.js";

vi.mock("../coach.js", () => ({
  coach: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  coach.mockReset();
});

describe("generateStageDoc", () => {
  it("calls coach with the stage's regenTask and includeContext true", async () => {
    coach.mockResolvedValue({ mode: "api", text: "# Doc" });
    const stage = { id: "onsite", regenTask: "Write the onsite prep doc." };

    const result = await generateStageDoc(stage);

    expect(coach).toHaveBeenCalledWith({
      task: stage.regenTask,
      includeContext: true,
    });
    expect(result).toEqual({ mode: "api", text: "# Doc" });
  });

  it("passes through paste mode result", async () => {
    coach.mockResolvedValue({ mode: "paste", prompt: "full prompt text" });
    const stage = { id: "final", regenTask: "Write the final round doc." };

    const result = await generateStageDoc(stage);

    expect(result).toEqual({ mode: "paste", prompt: "full prompt text" });
  });
});

describe("saveStageDoc", () => {
  it("saves markdown via store.setDocOverride, scoped to the active job", () => {
    const job = createJob({ role: "Engineer" });
    setActiveJobId(job.id);

    saveStageDoc("onsite", "# Generated doc");

    expect(getDocOverride("onsite").markdown).toBe("# Generated doc");
  });
});

describe("buildFlashcardsTask", () => {
  it("asks for 20-25 cards as strict JSON with the three category ids, grounded in the job", () => {
    const job = { role: "Backend Engineer", company: "Acme" };

    const task = buildFlashcardsTask(job);

    expect(task).toContain("Backend Engineer");
    expect(task).toContain("Acme");
    expect(task).toContain("20");
    expect(task).toContain("25");
    expect(task).toContain("behavioral");
    expect(task).toContain("situational");
    expect(task).toContain("role-specific");
    expect(task).toMatch(/json/i);
    expect(task.toLowerCase()).toContain("no markdown fences");
  });
});

describe("parseFlashcards", () => {
  it("parses a clean JSON array of valid cards", () => {
    const text = JSON.stringify([
      {
        category: "behavioral",
        question: "Tell me about a conflict.",
        referenceAnswer: "Use STAR.",
        keyPoints: ["Situation", "Action", "Result"],
      },
      {
        category: "situational",
        question: "What would you do if a deploy broke prod?",
        referenceAnswer: "Roll back first.",
        keyPoints: ["Rollback", "Postmortem"],
      },
    ]);

    const { cards, dropped } = parseFlashcards(text);

    expect(dropped).toBe(0);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      category: "behavioral",
      question: "Tell me about a conflict.",
      referenceAnswer: "Use STAR.",
      keyPoints: ["Situation", "Action", "Result"],
    });
    expect(cards[0].id).toMatch(/^gen-\d+-0$/);
    expect(cards[1].id).toMatch(/^gen-\d+-1$/);
  });

  it("strips markdown code fences and surrounding prose before parsing", () => {
    const text = [
      "Here are your flashcards:",
      "```json",
      JSON.stringify([
        { category: "role-specific", question: "Explain CAP theorem." },
      ]),
      "```",
      "Let me know if you want more!",
    ].join("\n");

    const { cards, dropped } = parseFlashcards(text);

    expect(dropped).toBe(0);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Explain CAP theorem.");
    expect(cards[0].referenceAnswer).toBe("");
    expect(cards[0].keyPoints).toEqual([]);
  });

  it("drops invalid cards but keeps valid ones, reporting the dropped count", () => {
    const text = JSON.stringify([
      { category: "behavioral", question: "Valid question one." },
      { category: "behavioral", question: "" }, // invalid: empty question
      { category: "behavioral" }, // invalid: missing question
      { category: "weird-category", question: "Valid but bad category." },
      "not an object", // invalid: not an object
    ]);

    const { cards, dropped } = parseFlashcards(text);

    expect(cards).toHaveLength(2);
    expect(dropped).toBe(3);
    expect(cards[0].question).toBe("Valid question one.");
    expect(cards[1].question).toBe("Valid but bad category.");
    // invalid category coerced to role-specific
    expect(cards[1].category).toBe("role-specific");
  });

  it("throws when there are zero valid cards", () => {
    const text = "This is just garbage, not JSON at all.";

    expect(() => parseFlashcards(text)).toThrow("Could not parse flashcards");
  });

  it("throws when the array parses but every card is invalid", () => {
    const text = JSON.stringify([{ category: "behavioral" }, { foo: "bar" }]);

    expect(() => parseFlashcards(text)).toThrow("Could not parse flashcards");
  });

  it("caps at 30 cards even if more are returned", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      category: "behavioral",
      question: `Question ${i}`,
    }));
    const text = JSON.stringify(many);

    const { cards, dropped } = parseFlashcards(text);

    expect(cards).toHaveLength(30);
    expect(dropped).toBe(10);
  });

  it("defaults referenceAnswer and keyPoints when missing", () => {
    const text = JSON.stringify([
      { category: "situational", question: "Missing extras?" },
    ]);

    const { cards } = parseFlashcards(text);

    expect(cards[0].referenceAnswer).toBe("");
    expect(cards[0].keyPoints).toEqual([]);
  });
});

describe("generateFlashcards", () => {
  it("api mode: calls coach with the flashcards task and returns parsed cards", async () => {
    const cardsJson = JSON.stringify([
      { category: "behavioral", question: "Q1", referenceAnswer: "A1", keyPoints: ["p1"] },
    ]);
    coach.mockResolvedValue({ mode: "api", text: cardsJson });
    const job = { role: "Engineer", company: "Acme" };

    const result = await generateFlashcards(job);

    expect(coach).toHaveBeenCalledWith({
      task: buildFlashcardsTask(job),
      includeContext: true,
    });
    expect(result.mode).toBe("api");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].question).toBe("Q1");
    expect(result.dropped).toBe(0);
  });

  it("paste mode: returns the prompt for the caller to copy", async () => {
    coach.mockResolvedValue({ mode: "paste", prompt: "copy this prompt" });
    const job = { role: "Engineer", company: "Acme" };

    const result = await generateFlashcards(job);

    expect(result).toEqual({ mode: "paste", prompt: "copy this prompt" });
  });
});
