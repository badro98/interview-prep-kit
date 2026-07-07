import { beforeEach, describe, expect, it } from "vitest";
import { getAdvisorSystem } from "../systemPrompt.js";
import { createJob, setActiveJobId } from "../../../lib/jobs.js";

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
});
