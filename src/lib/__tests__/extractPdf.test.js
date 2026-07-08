import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../extractPdf.js";

function mockFetchOnce(response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractPdfText", () => {
  it("posts the file as multipart form data and returns the text", async () => {
    const fetchFn = mockFetchOnce({
      ok: true,
      json: async () => ({ text: "# Resume\n\nQA Engineer" }),
    });
    const file = new File(["%PDF-1.4 fake"], "resume.pdf", { type: "application/pdf" });

    const text = await extractPdfText(file);

    expect(text).toBe("# Resume\n\nQA Engineer");
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/extract-pdf");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    const sent = opts.body.get("file");
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe("resume.pdf");
  });

  it("throws the server's error message on failure", async () => {
    mockFetchOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "PDF conversion needs GEMINI_API_KEY in .env" }),
    });
    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });

    await expect(extractPdfText(file)).rejects.toThrow(
      "PDF conversion needs GEMINI_API_KEY in .env"
    );
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("no json");
      },
    });
    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });

    await expect(extractPdfText(file)).rejects.toThrow("Could not convert PDF (500)");
  });
});
