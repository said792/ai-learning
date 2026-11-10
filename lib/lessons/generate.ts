import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ttsLongTextToPcm, ttsToPcm, type TtsOptions } from "@/lib/ai/tts";
import { pcmToWav, pcmChunksToWav } from "@/lib/wav";
import {
  renderCoverSlide,
  renderContentSlide,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
} from "@/lib/lessons/slides";
import {
  ensureFfmpeg,
  renderSlideVideo,
  concatVideos,
  writePcmAsWav,
  probeDurationSeconds,
} from "@/lib/files/video";
import { generateVeoClips } from "@/lib/lessons/veo";
import type { LessonScript } from "@/lib/ai/lesson";
import type { GeminiTier } from "@/lib/ai/gemini";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

/* =========================================================
   خطوط توليد الدروس:
   - صوت (شرح / بودكاست) → WAV
   - فيديو شرائح → MP4
   - فيديو Veo → MP4
========================================================= */

const STORAGE_BUCKET = "lessons";

/* مجلد العمل المؤقت:
   - كان ثابتًا على /tmp وهو خطأ على ويندوز (\tmp بيتحلّ لحسب درايف التشغيل
     وبيسبب أخطاء "No such file or directory" في ffmpeg)
   - os.tmpdir() يرجّع المسار الصحيح على كل الأنظمة
     (ويندوز: C:\Users\<user>\AppData\Local\Temp) */
const WORK_DIR = path.join(os.tmpdir(), "ai-lessons");

async function makeWorkDir(name: string): Promise<string> {
  const dir = path.join(WORK_DIR, `${name}-${crypto.randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/* =========================================================
   التخزين
========================================================= */

export async function uploadLessonFile(
  lessonId: string,
  ownerId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const ext = mimeType.includes("wav") ? "wav" : "mp4";
  const storagePath = `${ownerId}/${lessonId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: true,
    });

  if (error) {
    throw new Error(`فشل رفع الدرس إلى التخزين: ${error.message}`);
  }

  return storagePath;
}

export async function getLessonSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 6); // 6 ساعات

  if (error || !data) {
    console.error("[Lessons] فشل توليد رابط الدرس:", error?.message);
    return null;
  }

  return data.signedUrl;
}

/* =========================================================
   1) درس صوتي
========================================================= */

export async function generateAudioLesson(options: {
  lessonId: string;
  script: LessonScript;
  ownerId: string;
  tts: TtsOptions;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين */
  tier?: GeminiTier;
}): Promise<{ storagePath: string; mimeType: string; durationSec: number }> {
  const { lessonId, script, ownerId, tts, tier } = options;

  // النص الكامل للتوليد الصوتي
  const fullNarration = script.sections
    .map((s) => s.narration)
    .join("\n\n");

  console.log(`[Lessons] توليد الصوت (${fullNarration.length} حرف)...`);

  const { pcm } = await ttsLongTextToPcm(fullNarration, { ...tts, tier });
  const wav = pcmChunksToWav([pcm], 24_000, 1, 16);

  const durationSec = (wav.length - 44) / (24_000 * 2);

  const storagePath = await uploadLessonFile(lessonId, ownerId, wav, "audio/wav");

  console.log(`[Lessons] تم إنشاء الدرس الصوتي (${durationSec.toFixed(0)} ثانية)`);

  return {
    storagePath,
    mimeType: "audio/wav",
    durationSec,
  };
}

/* =========================================================
   2) درس فيديو (شرائح + تعليق صوتي)
========================================================= */

export async function generateSlidesVideoLesson(options: {
  lessonId: string;
  script: LessonScript;
  ownerId: string;
  tts: TtsOptions;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين */
  tier?: GeminiTier;
  onProgress?: (step: string, current: number, total: number) => void;
}): Promise<{ storagePath: string; mimeType: string; durationSec: number }> {
  const { lessonId, script, ownerId, tts, tier, onProgress } = options;

  await ensureFfmpeg();

  const workDir = await makeWorkDir("video");
  const total = script.sections.length;

  try {
    const segmentPaths: string[] = [];

    for (let i = 0; i < total; i++) {
      const section = script.sections[i];
      onProgress?.("render", i + 1, total);

      // الشريحة (الغلاف للقسم الأول، محتوى للبقية)
      const slidePng =
        i === 0
          ? renderCoverSlide({
              title: script.title,
              subtitle: section.heading,
              paletteIndex: 0,
            })
          : renderContentSlide({
              heading: section.heading,
              bullets: section.bullets,
              sectionNumber: i + 1,
              totalSections: total,
              paletteIndex: i,
            });

      const slidePath = path.join(workDir, `slide-${i}.png`);
      await writeFile(slidePath, slidePng);

      // الصوت
      const pcm = await ttsToPcm(section.narration, { ...tts, tier });
      const audioPath = path.join(workDir, `sec-${i}.wav`);
      await writePcmAsWav(pcm, audioPath, 24_000);

      // مقطع الفيديو
      const segmentPath = path.join(workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
      await renderSlideVideo(slidePath, audioPath, segmentPath, {
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
      });

      segmentPaths.push(segmentPath);

      console.log(`[Lessons] مقطع ${i + 1}/${total} اكتمل`);
    }

    onProgress?.("concat", total, total);

    // الدمج
    const finalPath = path.join(workDir, `${lessonId}.mp4`);
    await concatVideos(segmentPaths, finalPath);

    const { readFile } = await import("fs/promises");
    const videoBuffer = await readFile(finalPath);

    const storagePath = await uploadLessonFile(
      lessonId,
      ownerId,
      videoBuffer,
      "video/mp4"
    );

    // قياس المدة الفعلية للفيديو النهائي
    const durationSec = await probeDurationSeconds(finalPath);

    console.log(`[Lessons] تم إنشاء فيديو الدرس (${videoBuffer.length} بايت)`);

    return {
      storagePath,
      mimeType: "video/mp4",
      durationSec,
    };
  } finally {
    await cleanupDir(workDir);
  }
}

/* =========================================================
   3) درس فيديو AI (Veo)
========================================================= */

export async function generateVeoVideoLesson(options: {
  lessonId: string;
  script: LessonScript;
  ownerId: string;
  lang: "ar" | "en";
  maxClips?: number;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين */
  tier?: GeminiTier;
}): Promise<{ storagePath: string; mimeType: string; durationSec: number }> {
  const { lessonId, script, ownerId, lang, maxClips = 2, tier } = options;

  await ensureFfmpeg();

  const workDir = await makeWorkDir("veo");

  try {
    const clips = await generateVeoClips({
      script,
      maxClips,
      lang,
      workDir,
      tier,
    });

    if (clips.length === 0) {
      throw new Error("لم يتم توليد أي مقطع فيديو من Veo");
    }

    let finalBuffer: Buffer;
    let durationSec: number;

    if (clips.length === 1) {
      finalBuffer = await readFile(clips[0]);
      durationSec = await probeDurationSeconds(clips[0]);
    } else {
      const finalPath = path.join(workDir, `${lessonId}.mp4`);
      await concatVideos(clips, finalPath);
      finalBuffer = await readFile(finalPath);
      durationSec = await probeDurationSeconds(finalPath);
    }

    const storagePath = await uploadLessonFile(
      lessonId,
      ownerId,
      finalBuffer,
      "video/mp4"
    );

    return {
      storagePath,
      mimeType: "video/mp4",
      durationSec,
    };
  } finally {
    await cleanupDir(workDir);
  }
}
