import { ocrImage } from "@/lib/ai/gemini";

/* =========================================================
   استخراج النص من المستندات الممسوحة والصور (Gemini Vision)
   — الآن يعتمد على العميل الموحد lib/ai/gemini.ts
========================================================= */

export type OcrMimeType = { mimeType: string; data: Buffer };

export async function ocrWithGemini(
  buffer: Buffer,
  mimeType: string,
  lang: "ar" | "en" = "ar"
): Promise<string> {
  try {
    return await ocrImage({ mimeType, data: buffer }, lang);
  } catch (error) {
    console.error("[OCR Gemini] Error:", error);
    throw new Error(
      `فشل استخراج النص بالذكاء الاصطناعي: ${
        error instanceof Error ? error.message : "خطأ غير معروف"
      }`
    );
  }
}
