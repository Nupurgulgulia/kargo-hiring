import "server-only";

import { BULLET_PUA } from "./cv-quality.ts";

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

// Turns an uploaded CV file into plain text. Runs entirely on our server — the raw file
// (which contains PII) is never sent to the LLM.
export async function extractCvText(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  let text: string;

  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (ext === ".txt" || ext === ".md") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Unsupported file type "${ext}". Upload a PDF, DOCX or TXT file.`);
  }

  // Postgres text columns cannot hold NUL (0x00); some PDFs extract with them
  text = text.replace(/\u0000/g, "").replace(BULLET_PUA, "\u2022").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) {
    throw new Error(
      "Could not read enough text from this file (it may be a scanned image). Upload a text-based PDF or DOCX.",
    );
  }
  return text;
}
