// Shared file→entry intake for profile and custom context uploads.
// PDFs are converted server-side (Gemini); .md/.txt read locally.

import { extractPdfText } from "./extractPdf.js";

export function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export function entryNameFromFile(file) {
  return (file.name || "").replace(/\.(md|txt|pdf)$/i, "") || file.name;
}

/** Page title if present, else hostname, else the raw input. */
export function entryNameFromUrl(url, title) {
  const t = (title || "").trim();
  if (t) return t;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function readEntryFile(file) {
  const name = entryNameFromFile(file);
  if (isPdfFile(file)) {
    return { name, content: await extractPdfText(file) };
  }
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
  return { name, content };
}
