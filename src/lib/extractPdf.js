// Convert a PDF to markdown via the local proxy (Gemini does the extraction).

export async function extractPdfText(file) {
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch("/api/extract-pdf", { method: "POST", body: form });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Could not convert PDF (${res.status})`);
  }

  const { text } = await res.json();
  return text;
}
