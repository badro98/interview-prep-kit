import { describe, expect, it } from "vitest";
import { markdownToHtml, normalizePrepMarkdown } from "../markdownHtml.js";

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

describe("normalizePrepMarkdown", () => {
  const doc = "# Osama Badr - Interview Stories\n\n| Question | Story |\n| --- | --- |\n| Tell me about yourself | Pitch |";

  it("unwraps a markdown fence around a full doc, keeping inner code samples", () => {
    const fenced = "```markdown\n# Practical coding\n\n```js\nfunction twoSum() {}\n```\n\nTalk through tests.\n```";
    expect(normalizePrepMarkdown(fenced)).toBe(
      "# Practical coding\n\n```js\nfunction twoSum() {}\n```\n\nTalk through tests."
    );
  });

  it("unwraps an unclosed markdown fence when the body looks like a doc", () => {
    expect(normalizePrepMarkdown("```md\n" + doc)).toBe(doc);
  });

  it("dedents a body that was indented inside XML", () => {
    const indented = "    # Title\n    \n    | Question | Story |\n    | --- | --- |";
    expect(normalizePrepMarkdown(indented)).toBe("# Title\n\n| Question | Story |\n| --- | --- |");
  });

  it("does not unwrap a real js fence at the start of a snippet", () => {
    const snippet = "```js\nfunction twoSum() {}\n```";
    expect(normalizePrepMarkdown(snippet)).toBe(snippet);
  });

  it("parses a previously fenced doc as headings, not a code block", () => {
    const html = markdownToHtml("```markdown\n" + doc + "\n```");
    expect(html).toMatch(/<h1>/);
    expect(html).toMatch(/<table>/);
    expect(html).not.toMatch(/<pre>/);
  });
});
