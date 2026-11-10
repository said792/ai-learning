import path from "path";
import { MODELS, withKeyRotation, type GeminiTier } from "@/lib/ai/gemini";
import { ensureFfmpeg } from "@/lib/files/video";
import type { LessonScript } from "@/lib/ai/lesson";

/* =========================================================
   توليد مقاطع فيديو AI عبر Veo
   (لقطات ~8 ثوانٍ لكل مقطع — تُدمج بـ ffmpeg)
========================================================= */

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60; // ~10 دقائق لكل مقطع

/** فك روابط فيديو من استجابة عملية Veo */
function extractVideoUris(operation: unknown): string[] {
  const op = operation as {
    response?: {
      generatedVideos?: Array<{
        video?: { uri?: string };
      }>;
    };
  };

  return (op?.response?.generatedVideos || [])
    .map((v) => v.video?.uri || "")
    .filter(Boolean);
}

export async function generateVeoClips(options: {
  script: LessonScript;
  maxClips: number;
  lang: "ar" | "en";
  workDir: string;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين */
  tier?: GeminiTier;
}): Promise<string[]> {
  const { script, maxClips, lang, workDir, tier } = options;

  console.log(`[Veo] بدء توليد ${maxClips} مقطع فيديو بموديل ${MODELS.video}`);

  const prompts = buildVeoPrompts(script, maxClips, lang);
  const clipPaths: string[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const clipPath = await generateSingleVeoClip(prompts[i], i, workDir, tier);

    if (clipPath) {
      clipPaths.push(clipPath);
    }
  }

  return clipPaths;
}

function buildVeoPrompts(
  script: LessonScript,
  maxClips: number,
  lang: "ar" | "en"
): string[] {
  const summary = script.sections
    .slice(0, maxClips * 2)
    .map((s) => `${s.heading}: ${s.bullets.slice(0, 3).join("، ")}`)
    .join(" | ");

  // Veo يفهم الإنجليزية أفضل للـ prompts السينمائية
  const baseStyle =
    "Clean modern educational explainer video, smooth camera movement, soft studio lighting, abstract educational visuals, no text overlays, 16:9";

  const prompts: string[] = [];

  const themes = script.sections
    .slice(0, maxClips)
    .map((s) => s.heading)
    .filter(Boolean);

  for (let i = 0; i < maxClips; i++) {
    const theme = themes[i] || script.title;

    prompts.push(
      lang === "ar"
        ? `فيديو تعليمي قصير عن: ${theme}. سياق الدرس: ${summary.substring(0, 400)}. أسلوب: رسوم متحركة تعليمية أنيقة، إضاءة استوديو ناعمة، حركة كاميرا سلسة، بدون نصوص على الشاشة.`
        : `Short educational video about: ${theme}. Lesson context: ${summary.substring(0, 400)}. ${baseStyle}.`
    );
  }

  return prompts;
}

async function generateSingleVeoClip(
  prompt: string,
  index: number,
  workDir: string,
  tier?: GeminiTier
): Promise<string | null> {
  try {
    const videoBuffer = await withKeyRotation(
      async (client, apiKey) => {
      let operation = await client.models.generateVideos({
        model: MODELS.video,
        prompt,
        config: {
          aspectRatio: "16:9",
          numberOfVideos: 1,
        } as never,
      });

      // الانتظار حتى انتهاء المعالجة
      let attempts = 0;

      while (!operation.done && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        operation = await client.operations.getVideosOperation({
          operation,
        } as never);
        attempts++;
      }

      if (!operation.done) {
        throw new Error("انتهت مهلة انتظار Veo");
      }

      const uris = extractVideoUris(operation);

      if (uris.length === 0) {
        throw new Error("لم يُرجع Veo أي مقاطع فيديو");
      }

      // تنزيل الملف (يتطلب المفتاح في الرابط)
      const downloadUrl = uris[0].includes("key=")
        ? uris[0]
        : `${uris[0]}${uris[0].includes("?") ? "&" : "?"}key=${apiKey}`;

      const res = await fetch(downloadUrl);

      if (!res.ok) {
        throw new Error(`فشل تنزيل فيديو Veo: ${res.status}`);
      }

      return Buffer.from(await res.arrayBuffer());
      },
      { tier }
    );

    const outputPath = path.join(workDir, `veo-${index}.mp4`);
    const { writeFile } = await import("fs/promises");
    await writeFile(outputPath, videoBuffer);

    console.log(`[Veo] مقطع ${index + 1} اكتمل (${videoBuffer.length} بايت)`);

    return outputPath;
  } catch (error) {
    console.error(`[Veo] فشل توليد المقطع ${index + 1}:`, error);
    return null;
  }
}

// ضمان وجود ffmpeg قبل أي عملية دمج لاحقة
void ensureFfmpeg().catch(() => undefined);
