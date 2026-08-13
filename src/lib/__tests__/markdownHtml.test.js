import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../markdownHtml.js";

describe("markdownToHtml", () => {
  it("converts headings and lists", () => {
    const html = markdownToHtml("# Title\n\n- one\n- two");
    expect(html).toMatch(/<h1>/);
    expect(html).toMatch(/<li>/);
  });

  it("returns an empty paragraph for blank input", () => {
    expect(markdownToHtml("")).toBe("<p></p>");
  });
});
