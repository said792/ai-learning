import { transcribeMedia, AUDIO_MIME_TYPES } from "@/lib/ai/gemini";
import path from "path";

/* =========================================================
   نسخ الصوت إلى نص (Gemini Files API + الموديل الموحد)
========================================================= */

export async function transcribeAudioToText(
  filePath: string,
  lang: "ar" | "en" = "ar"
): Promise<string> {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);

  const ext = path.extname(filePath).replace(".", "").toLowerCase();
  const mimeType = AUDIO_MIME_TYPES[ext] || "audio/wav";

  console.log(
    `[Transcribe] بدء نسخ الصوت (${mimeType}) باستخدام العميل الموحد...`
  );

  const text = await transcribeMedia(buffer, mimeType, lang);

  const clean = (text || "").trim();

  if (!clean) {
    throw new Error("لم يتم استخراج أي نص من الملف الصوتي");
  }

  console.log(`[Transcribe] اكتمل النسخ. عدد الأحرف: ${clean.length}`);

  return clean;
}
