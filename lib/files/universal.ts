import path from "path";
import { getFormatInfo, IMAGE_MIME_MAP } from "@/lib/files/registry";
import { extractPdfText } from "@/lib/files/pdf";
import { extractWordText } from "@/lib/files/word";
import { extractPowerPointText } from "@/lib/files/powerpoint";
import { extractSpreadsheetText } from "@/lib/files/sheets";
import { extractTextFormats } from "@/lib/files/textformats";
import { extractAudioFromVideo } from "@/lib/files/video";
import { transcribeAudioToText } from "@/lib/files/transcribe";
import { ocrWithGemini } from "@/lib/files/ocr-gemini";
import { convertWithLibreOffice, cleanupConverted } from "@/lib/files/office-convert";

/* =========================================================
   المُوجّه الموحد لاستخراج النص من أي صيغة مدعومة
========================================================= */

export type ExtractionResult = {
  text: string;
  /** وصف رسالة الخطأ الأنسب لو النص فارغ */
  emptyReason?: string;
};

export type UniversalExtractionInput = {
  filePath: string;
  originalName: string;
  extension: string;
  fileBuffer: Buffer;
  /** MIME الأصلي من الطلب */
  fileMime?: string;
  lang: "ar" | "en";
  isVideo: boolean;
  isAudio: boolean;
  isImage: boolean;
};

/** امتدادات الميديا */
export const VIDEO_EXTS = [
  ".mp4", ".webm", ".mov", ".avi", ".wmv", ".mkv",
  ".m4v", ".3gp", ".flv", ".mpg", ".mpeg", ".ts",
];

export const AUDIO_EXTS = [
  ".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus",
  ".flac", ".aac", ".wma", ".aiff", ".aif", ".weba", ".m4b",
];

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTS.includes(ext.toLowerCase());
}

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXTS.includes(ext.toLowerCase());
}

export function isImageExt(ext: string): boolean {
  return Boolean(IMAGE_MIME_MAP[ext.toLowerCase()]);
}

export async function extractTextFromAnyFile(
  input: UniversalExtractionInput
): Promise<ExtractionResult> {
  const {
    filePath,
    originalName,
    extension: extRaw,
    fileBuffer,
    fileMime,
    lang,
  } = input;

  const ext = extRaw.toLowerCase();
  const info = getFormatInfo(ext);

  /* ================= الوسائط: فيديو / صوت ================= */
  if (input.isVideo) {
    const audioPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.wav`);
    await extractAudioFromVideo(filePath, audioPath);
    const text = await transcribeAudioToText(audioPath, lang);
    return { text };
  }

  if (input.isAudio) {
    const text = await transcribeAudioToText(filePath, lang);
    return { text };
  }

  /* ================= PDF ================= */
  if (ext === ".pdf") {
    let text = await extractPdfText(filePath);

    if (!text.trim()) {
      console.log(`[Universal] PDF ممسوح → OCR بالذكاء الاصطناعي: ${originalName}`);
      text = await ocrWithGemini(fileBuffer, "application/pdf", lang);
    }

    return { text };
  }

  /* ================= صور ================= */
  if (isImageExt(ext)) {
    const mime = IMAGE_MIME_MAP[ext] || fileMime || "image/jpeg";

    // SVG يُقرأ كنص مباشرة
    if (ext === ".svg") {
      const svgText = fileBuffer.toString("utf-8");
      const stripped = svgText
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // SVG به نصوص + OCR كاحتياط
      if (stripped.length > 40) {
        return { text: stripped };
      }
    }

    const text = await ocrWithGemini(fileBuffer, mime, lang);
    return { text };
  }

  /* ================= Word ================= */
  if (ext === ".docx" || ext === ".doc" || ext === ".odt" || ext === ".rtf" || ext === ".wps") {
    const text = await extractWordText(filePath);
    return { text };
  }

  /* ================= PowerPoint ================= */
  if (ext === ".pptx" || ext === ".ppt" || ext === ".odp") {
    const text = await extractPowerPointText(filePath);
    return { text };
  }

  /* ================= جداول ================= */
  if (ext === ".xlsx" || ext === ".xls" || ext === ".ods" || ext === ".csv") {
    const text = await extractSpreadsheetText(filePath);
    return { text };
  }

  /* ================= نصوص وويب ================= */
  if (ext === ".txt" || ext === ".md" || ext === ".html" || ext === ".htm" || ext === ".epub") {
    const text = await extractTextFormats(filePath, ext);
    return { text };
  }

  /* ================= محاولات أخيرة: LibreOffice ثم OCR ================= */
  console.log(`[Universal] صيغة غير قياسية (${ext}) — محاولة التحويل عبر LibreOffice: ${originalName}`);

  try {
    const convertedPath = await convertWithLibreOffice(filePath, "pdf");

    try {
      const text = await extractPdfText(convertedPath);

      if (text.trim()) {
        return { text };
      }

      // PDF ناتج عن تحويل قد يكون صور — OCR عليه
      const { readFile } = await import("fs/promises");
      const convertedBuffer = await readFile(convertedPath);
      const ocrText = await ocrWithGemini(convertedBuffer, "application/pdf", lang);

      return { text: ocrText };
    } finally {
      await cleanupConverted(convertedPath);
    }
  } catch (convertError) {
    console.error("[Universal] فشل التحويل الاحتياطي:", convertError);
  }

  return {
    text: "",
    emptyReason: `لم يتم استخراج أي نص من الملف (${ext}). تأكد من أن الملف يحتوي على نص قابل للقراءة أو صورة/صوت واضح.`,
  };
}
