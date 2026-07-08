import { describe, expect, it, vi } from "vitest";

vi.mock("../extractPdf.js", () => ({
  extractPdfText: vi.fn(async () => "# Converted markdown"),
}));

import { extractPdfText } from "../extractPdf.js";
import {
  isPdfFile,
  entryNameFromFile,
  entryNameFromUrl,
  readEntryFile,
} from "../entryFile.js";

describe("isPdfFile", () => {
  it("detects PDFs by mimetype", () => {
    expect(isPdfFile(new File(["x"], "cv", { type: "application/pdf" }))).toBe(true);
  });

  it("detects PDFs by extension when the type is missing", () => {
    expect(isPdfFile(new File(["x"], "cv.PDF", { type: "" }))).toBe(true);
  });

  it("rejects text files", () => {
    expect(isPdfFile(new File(["x"], "notes.md", { type: "text/markdown" }))).toBe(false);
  });
});

describe("entryNameFromFile", () => {
  it("strips known extensions", () => {
    expect(entryNameFromFile(new File(["x"], "My Resume.pdf"))).toBe("My Resume");
    expect(entryNameFromFile(new File(["x"], "notes.md"))).toBe("notes");
  });

  it("keeps unknown extensions", () => {
    expect(entryNameFromFile(new File(["x"], "archive.tar"))).toBe("archive.tar");
  });
});

describe("entryNameFromUrl", () => {
  it("prefers the page title", () => {
    expect(entryNameFromUrl("https://osama.dev", "Osama — Portfolio")).toBe(
      "Osama — Portfolio"
    );
  });

  it("falls back to the hostname", () => {
    expect(entryNameFromUrl("https://osama.dev/projects", "")).toBe("osama.dev");
  });

  it("returns the raw input when it is not a URL", () => {
    expect(entryNameFromUrl("not a url", "")).toBe("not a url");
  });
});

describe("readEntryFile", () => {
  it("routes PDFs through extractPdfText", async () => {
    const file = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
    const entry = await readEntryFile(file);
    expect(extractPdfText).toHaveBeenCalledWith(file);
    expect(entry).toEqual({ name: "resume", content: "# Converted markdown" });
  });

  it("reads text files locally", async () => {
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    const entry = await readEntryFile(file);
    expect(entry).toEqual({ name: "notes", content: "hello world" });
  });
});
