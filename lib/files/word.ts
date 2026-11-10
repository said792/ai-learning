import mammoth from "mammoth";
import path from "path";
import { convertWithLibreOffice } from "@/lib/files/office-convert";

/* =========================================================
   استخراج نص Word
   - .docx → mammoth مباشرة
   - .doc  → تحويل بـ LibreOffice إلى docx ثم mammoth
========================================================= */

export async function extractWordText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  let targetPath = filePath;

  // الصيغ غير docx تُحوَّل عبر LibreOffice أولاً
  if (ext === ".doc" || ext === ".rtf" || ext === ".odt" || ext === ".wps") {
    console.log(`[Word] تحويل ملف ${ext} عبر LibreOffice: ${path.basename(filePath)}`);
    targetPath = await convertWithLibreOffice(filePath, "docx");
  }

  const { readFile } = await import("fs/promises");
  const buffer = await readFile(targetPath);

  const result = await mammoth.extractRawText({ buffer });

  return result.value;
}
