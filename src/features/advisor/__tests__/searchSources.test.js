import { describe, expect, it } from "vitest";
import { splitSearchSources, uniqueSourceHosts } from "../searchSources.js";

describe("splitSearchSources", () => {
  it("leaves ordinary replies unchanged", () => {
    expect(splitSearchSources("Just a note.")).toEqual({
      body: "Just a note.",
      sources: [],
    });
  });

  it("strips a trailing Sources list and dedupes identical URLs", () => {
    const text = `Nuro licenses software.

**Sources:**
- [Nuro](https://www.nuro.ai/about)
- [Nuro](https://www.nuro.ai/about)
- [Zoox](https://zoox.com/)
`;
    const { body, sources } = splitSearchSources(text);
    expect(body).toBe("Nuro licenses software.");
    expect(sources).toEqual([
      { title: "Nuro", url: "https://www.nuro.ai/about", host: "nuro.ai" },
      { title: "Zoox", url: "https://zoox.com/", host: "zoox.com" },
    ]);
  });
});

describe("uniqueSourceHosts", () => {
  it("keeps the first URL per hostname", () => {
    const unique = uniqueSourceHosts([
      { host: "nuro.ai", url: "https://nuro.ai/a", title: "A" },
      { host: "nuro.ai", url: "https://nuro.ai/b", title: "B" },
      { host: "zoox.com", url: "https://zoox.com/", title: "Zoox" },
    ]);
    expect(unique.map((s) => s.url)).toEqual([
      "https://nuro.ai/a",
      "https://zoox.com/",
    ]);
  });
});
