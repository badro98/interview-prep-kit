import { describe, expect, it } from "vitest";
import { extractUrls, normalizeUrlInput } from "../fetchUrl.js";

describe("extractUrls", () => {
  it("finds urls and strips trailing punctuation", () => {
    expect(extractUrls("see https://osama.dev, ok")).toEqual(["https://osama.dev"]);
  });
});

describe("normalizeUrlInput", () => {
  it("returns the first url found in the text", () => {
    expect(normalizeUrlInput("my site: https://osama.dev/projects")).toBe(
      "https://osama.dev/projects"
    );
  });

  it("coerces a bare host to https", () => {
    expect(normalizeUrlInput("osama.dev")).toBe("https://osama.dev");
  });

  it("returns null for empty or unusable input", () => {
    expect(normalizeUrlInput("")).toBeNull();
    expect(normalizeUrlInput("   ")).toBeNull();
    expect(normalizeUrlInput("not a url at all")).toBeNull();
  });
});
