import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export async function extractResumeText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    return fs.readFile(filePath, "utf-8");
  }

  if (ext === ".pdf") {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(
    `Cannot extract text from ${ext} files yet. Please upload a PDF, DOCX, or TXT resume.`,
  );
}
