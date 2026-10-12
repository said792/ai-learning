import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * اختيار API Key عشوائي من الـ keys المتاحة
 */
function getGeminiApiKey(): string {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
  ].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error(
      "لا يوجد GEMINI_API_KEY في متغيرات البيئة. أضف GEMINI_API_KEY_1 على الأقل في .env.local"
    );
  }

  // اختيار عشوائي لتوزيع الحمل
  return keys[Math.floor(Math.random() * keys.length)];
}

/**
 * استخراج النص من المستندات الممسوحة والصور باستخدام Gemini Vision
 */
export async function ocrWithGemini(
  buffer: Buffer,
  mimeType: string,
  lang: "ar" | "en" = "ar"
): Promise<string> {
  const apiKey = getGeminiApiKey();

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // استخدم الموديل من البيئة أو gemini-2.0-flash كافتراضي
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt =
      lang === "ar"
        ? `أنت أداة لاستخراج النصوص من الصور والمستندات الممسوحة (OCR).
استخرج كل النص الموجود في هذا الملف بالضبط كما هو مكتوب، مع الحفاظ على الترتيب والتنسيق قدر الإمكان.
إذا كان الملف يحتوي على نص عربي وأجنبي، استخرج الاثنين.
أعد النص المستخرج فقط، بدون أي تعليق أو شرح أو ملاحظة أو عناوين إضافية.`
        : `You are an OCR tool for extracting text from scanned documents and images.
Extract all text from this file exactly as written, preserving order and formatting as much as possible.
If the file contains both Arabic and English text, extract both.
Return only the extracted text, without any comments, explanations, or notes.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: buffer.toString("base64"),
        },
      },
    ]);

    const text = result.response.text();
    return text || "";
  } catch (error) {
    console.error("[OCR Gemini] Error:", error);
    throw new Error(
      `فشل استخراج النص بالذكاء الاصطناعي: ${
        error instanceof Error ? error.message : "خطأ غير معروف"
      }`
    );
  }
}