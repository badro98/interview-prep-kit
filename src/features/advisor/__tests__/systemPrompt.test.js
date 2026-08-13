import { beforeEach, describe, expect, it } from "vitest";
import { getAdvisorSystem } from "../systemPrompt.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";
import { setProfileName } from "../../../lib/profile.js";
import { APP } from "../../../../interview.config.js";

beforeEach(() => {
  localStorage.clear();
});

describe("getAdvisorSystem", () => {
  it("builds the prompt fresh from the active job on every call (no module-load caching)", () => {
    const jobA = createJob({ role: "Staff Engineer", company: "Rocket Inc" });
    setActiveJobId(jobA.id);
    const first = getAdvisorSystem();
    expect(first).toContain("Staff Engineer");
    expect(first).toContain("Rocket Inc");

    const jobB = createJob({ role: "PM", company: "Acme" });
    setActiveJobId(jobB.id);
    const second = getAdvisorSystem();
    expect(second).toContain("PM");
    expect(second).toContain("Acme");
    expect(second).not.toContain("Staff Engineer");
  });

  it("uses the shared profile name when set, falling back to APP.candidateName otherwise", () => {
    const job = createJob({ role: "Staff Engineer", company: "Rocket Inc" });
    setActiveJobId(job.id);

    expect(getAdvisorSystem()).toContain(APP.candidateName);

    setProfileName("Osama Badr");
    expect(getAdvisorSystem()).toContain("Osama Badr");
  });

  it("appends RESPONSE_STYLE with concise-by-default and search-awareness rules", () => {
    const job = createJob({ role: "Staff Engineer", company: "Rocket Inc" });
    setActiveJobId(job.id);
    const prompt = getAdvisorSystem();

    expect(prompt).toContain("RESPONSE_STYLE:");
    expect(prompt).toContain("Default to concise answers");
    expect(prompt).toContain("4–8 tight bullets");
    expect(prompt).toContain("~150 words");
    expect(prompt).toMatch(/Expand into full detail only when the user asks/i);
    expect(prompt).toContain("Never abbreviate the advisor-actions JSON block");
    expect(prompt).toMatch(/web search/i);
    expect(prompt).toMatch(/cite sources/i);
  });

  it("includes stage ids and instructs flashcards to carry stageId", () => {
    const job = createJob({
      role: "Staff Engineer",
      company: "Rocket Inc",
      stages: [{ id: "takehome", title: "Take-home", subtitle: "Exercise" }],
    });
    setActiveJobId(job.id);
    const prompt = getAdvisorSystem();
    expect(prompt).toContain('id="takehome"');
    expect(prompt).toMatch(/stageId/);
    expect(prompt).toMatch(/Current in-progress stage/i);
  });
});
