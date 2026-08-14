import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFile } from "fs/promises";

/* =========================================================
   قراءة أي مفتاح Gemini متاح (من 1 إلى 5)
   وقراءة اسم الموديل من المتغيرات
======================================================== */

function getGeminiConfig(): { apiKey: string; model: string } {
  for (let i = 1; i <= 5; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key && key.trim() !== "") {
      return {
        apiKey: key.trim(),
        model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      };
    }
  }
  return { apiKey: "", model: "gemini-1.5-flash" };
}

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
};

/* =========================================================
   رفع الملف باستخدام Fetch مباشرة (بدون GoogleAIFileManager)
======================================================== */

async function uploadFileToGemini(
  filePath: string,
  mimeType: string,
  apiKey: string
): Promise<{ fileUri: string; name: string; fileMimeType: string }> {
  const fileBuffer = await readFile(filePath);

  const form = new FormData();
  form.append(
    "file",
    new Blob([fileBuffer], { type: mimeType }),
    "audio.wav"
  );

  const res = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey },
      body: form,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`فشل رفع الملف لـ Gemini: ${res.status} - ${errText}`);
  }

  const data = await res.json();

  return {
    fileUri: data.file.uri,
    name: data.file.name,
    fileMimeType: data.file.mimeType,
  };
}

/* =========================================================
   الانتظار حتى تكتمل معالجة الملف
======================================================== */

async function pollFileStatus(
  fileName: string,
  apiKey: string
): Promise<void> {
  let attempts = 0;

  while (attempts < 60) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      {
        headers: { "x-goog-api-key": apiKey },
      }
    );

    const data = await res.json();

    if (data.state === "ACTIVE") return;

    if (data.state === "FAILED") {
      throw new Error("فشل معالجة الملف الصوتي في Gemini: FAILED");
    }

    attempts++;
  }

  throw new Error("انتهت مهلة الانتظار لمعالجة الملف الصوتي");
}

/* =========================================================
   حذف الملف من Gemini
======================================================== */

async function deleteGeminiFile(
  fileName: string,
  apiKey: string
): Promise<void> {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      {
        method: "DELETE",
        headers: { "x-goog-api-key": apiKey },
      }
    );
  } catch {
    /* silent cleanup */
  }
}

/* =========================================================
   الوظيفة الرئيسية: نسخ الصوت إلى نص
======================================================== */

export async function transcribeAudioToText(
  filePath: string,
  lang: string
): Promise<string> {
  const { apiKey, model } = getGeminiConfig();

  if (!apiKey) {
    throw new Error(
      "لا يوجد مفتاح Gemini متاح. لا يمكن استخراج النص من الملفات الصوتية."
    );
  }

  const ext = filePath.split(".").pop()?.toLowerCase() || "wav";
  const mimeType = MIME_TYPES[ext] || "audio/wav";

  console.log(
    `[Transcribe] رفع الملف الصوتي إلى Gemini: ${filePath} (${mimeType}) باستخدام الموديل: ${model}`
  );

  /* 1. رفع الملف لـ Gemini */
  const { fileUri, name, fileMimeType } = await uploadFileToGemini(
    filePath,
    mimeType,
    apiKey
  );

  console.log(`[Transcribe] تم الرفع: ${fileUri}`);

  /* 2. الانتظار حتى تكتمل معالجة الملف */
  await pollFileStatus(name, apiKey);

  /* 3. نسخ الصوت إلى نص */
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });

  const prompt =
    lang === "en"
      ? "Transcribe this audio completely and accurately. Output ONLY the transcribed text without any additional commentary, notes, timestamps, or formatting."
      : "قم بنسخ هذا الصوت بالكامل وبشكل دقيق. أخرج النص المنسوخ فقط بدون أي تعليقات إضافية أو ملاحظات أو طوابع زمنية أو تنسيق.";

  console.log(`[Transcribe] بدء عملية النسخ...`);

  const result = await genModel.generateContent([
    {
      fileData: {
        mimeType: fileMimeType,
        fileUri: fileUri,
      },
    },
    { text: prompt },
  ]);

  const text = result.response.text().trim();

  /* 4. حذف الملف من Gemini عشان نوفر المساحة */
  await deleteGeminiFile(name, apiKey);

  if (!text) {
    throw new Error("لم يتم استخراج أي نص من الملف الصوتي");
  }

  console.log(
    `[Transcribe] اكتمل النسخ. عدد الأحرف: ${text.length}`
  );

  return text;
}