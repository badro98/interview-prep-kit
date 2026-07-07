// Behavioral pin (not a component test — @testing-library isn't installed and
// we don't add dependencies for this). These tests document the STORE behavior
// that the "capture jobId, guard on resolve" pattern in PrepDocs.jsx and
// Flashcards.jsx relies on: store.js helpers resolve `job:<ACTIVE>:` at WRITE
// time, so an in-flight async op that writes after the active job changes will
// silently land in the new active job's namespace unless the call site guards
// itself first.

import { beforeEach, describe, expect, it } from "vitest";
import { createJob, setActiveJobId, getActiveJobId } from "../jobs.js";
import { setDocOverride, getDocOverride } from "../store.js";

beforeEach(() => {
  localStorage.clear();
});

describe("job switch guard — underlying store behavior", () => {
  it("pin: a write issued while job B is active lands in job B's namespace, even if it logically belongs to job A", () => {
    const jobA = createJob({ role: "A" });
    const jobB = createJob({ role: "B" });

    setActiveJobId(jobA.id);
    // Simulate: async op started while A was active...
    // ...but by the time it resolves and writes, the user has switched to B.
    setActiveJobId(jobB.id);
    setDocOverride("stage-1", "result meant for A, written late");

    // Bug this pins: store.js has no idea the write "belongs" to A — it just
    // resolves against whatever job is active *now*.
    expect(getDocOverride("stage-1")).toEqual(
      expect.objectContaining({ markdown: "result meant for A, written late" })
    );

    setActiveJobId(jobA.id);
    expect(getDocOverride("stage-1")).toBeNull();
  });

  it("guarded pattern: capturing jobId before the async op and checking it on resolve prevents the cross-job write", () => {
    const jobA = createJob({ role: "A" });
    const jobB = createJob({ role: "B" });

    setActiveJobId(jobA.id);
    const jobId = getActiveJobId(); // captured before the "await"

    // ...user switches jobs while the async op is in flight...
    setActiveJobId(jobB.id);

    // Guard mirrors the call-site pattern: `if (jobId !== getActiveJobId()) return;`
    function guardedSave(text) {
      if (jobId !== getActiveJobId()) return; // drop the result silently
      setDocOverride("stage-1", text);
    }
    guardedSave("result meant for A, arriving late");

    // Nothing was written to B...
    expect(getDocOverride("stage-1")).toBeNull();

    // ...and nothing was written to A either (guard drops it, does not redirect it).
    setActiveJobId(jobA.id);
    expect(getDocOverride("stage-1")).toBeNull();
  });
});
