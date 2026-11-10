import JSZip from "jszip";
import path from "path";
import { convertWithLibreOffice } from "@/lib/files/office-convert";

/* =========================================================
   استخراج نص PowerPoint
   - .pptx → قراءة XML الشرائح مباشرة بـ JSZip (بدون عمليات فرعية)
   - .ppt  → تحويل بـ LibreOffice إلى pptx ثم القراءة
========================================================= */

function xmlToText(xml: string): string {
  return xml
    .replace(/<a:br\s*\/?>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<a:t>/g, "")
    .replace(/<\/a:t>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function extractPowerPointText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  let targetPath = filePath;

  if (ext === ".ppt") {
    console.log(`[PPT] تحويل ملف .ppt عبر LibreOffice: ${path.basename(filePath)}`);
    targetPath = await convertWithLibreOffice(filePath, "pptx");
  }

  const { readFile } = await import("fs/promises");
  const buffer = await readFile(targetPath);

  if (!buffer.length) {
    throw new Error("ملف PowerPoint فارغ");
  }

  const zip = await JSZip.loadAsync(buffer);

  // ترتيب الشرائح رقميًا وليس أبجديًا (slide1, slide2, ... slide10)
  const slideNames = Object.keys(zip.files)
    .filter(
      (name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
        /^ppt\/slides\/slide\d+.*\.xml$/.test(name)
    )
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0", 10);
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0", 10);
      return na - nb;
    });

  if (slideNames.length === 0) {
    throw new Error("ملف PowerPoint لا يحتوي على شرائح قابلة للقراءة");
  }

  const parts: string[] = [];

  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async("text");
    const text = xmlToText(xml);

    if (text) {
      parts.push(`--- الشريحة ${i + 1} ---\n${text}`);
    }
  }

  const combined = parts.join("\n\n").trim();

  if (!combined) {
    throw new Error("لم يتم العثور على نص داخل شرائح PowerPoint");
  }

  return combined;
}
