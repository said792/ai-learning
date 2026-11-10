import JSZip from "jszip";
import { readFile } from "fs/promises";
import path from "path";

/* =========================================================
   استخراج نص الصيغ النصية: md / html / rtf / epub / txt
========================================================= */

/** فك كيانات HTML الأساسية */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** إزالة وسوم HTML مع محاولة الحفاظ على فواصل الأسطر */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** إزالة أوامر RTF والاحتفاظ بالنص */
export function rtfToText(rtf: string): string {
  return decodeHtmlEntities(
    rtf
      // كتل الالتفاف
      .replace(/\{\\\*[^{}]*\}/g, " ")
      // أوامر التحكم المعروفة
      .replace(/\\par[d]?\b/g, "\n")
      .replace(/\\line\b/g, "\n")
      .replace(/\\tab\b/g, "\t")
      // ترميز يونيكود \uNNNN
      .replace(/\\u(-?\d+)\??/g, (_, code) => {
        const n = Number(code);
        return n < 0 ? String.fromCharCode(65536 + n) : String.fromCharCode(n);
      })
      // باقي أوامر التحكم
      .replace(/\\'[0-9a-fA-F]{2}/g, "")
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
      .replace(/[{}]/g, "")
  )
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** استخراج نص EPUB (ملف zip يحوي xhtml) */
export async function epubToText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const htmlNames = Object.keys(zip.files)
    .filter(
      (name) =>
        /\.x?html?$/i.test(name) &&
        !/^(cover|toc|nav|index)\./i.test(path.basename(name))
    )
    .sort();

  const parts: string[] = [];

  for (const name of htmlNames) {
    const xml = await zip.files[name].async("string");
    const text = htmlToText(xml);

    if (text) parts.push(text);
  }

  const combined = parts.join("\n\n").trim();

  if (!combined) {
    throw new Error("لم يتم استخراج نص من ملف EPUB");
  }

  return combined;
}

/**
 * نقطة الدخول الموحدة للصيغ النصية
 */
export async function extractTextFormats(
  filePath: string,
  extension: string
): Promise<string> {
  const ext = extension.toLowerCase();

  // Markdown و TXT: نص مباشر
  if (ext === ".md" || ext === ".txt" || ext === ".csv") {
    const { readFile } = await import("fs/promises");
    const buffer = await readFile(filePath);
    return buffer.toString("utf-8").replace(/\r\n/g, "\n").trim();
  }

  // HTML: نص مع إزالة الوسوم
  if (ext === ".html" || ext === ".htm") {
    const { readFile } = await import("fs/promises");
    const buffer = await readFile(filePath);
    return htmlToText(buffer.toString("utf-8"));
  }

  // RTF: إزالة أوامر التنسيق
  if (ext === ".rtf") {
    const { readFile } = await import("fs/promises");
    const buffer = await readFile(filePath);
    return rtfToText(buffer.toString("utf-8"));
  }

  // EPUB: قراءة xhtml من الأرشيف
  if (ext === ".epub") {
    return epubToText(filePath);
  }

  throw new Error(`صيغة نصية غير مدعومة: ${ext}`);
}
