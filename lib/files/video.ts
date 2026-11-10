import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/* =========================================================
   إصلاح مسار ffmpeg (كان ثابتًا على ffmpeg.exe لويندوز فقط)
   - يستخدم ffmpeg-static (متوافق مع كل الأنظمة)
   - ويرجع لـ ffmpeg المثبت في النظام إن لم يوجد
========================================================= */

async function resolveFfmpegPath(): Promise<string> {
  try {
    // ffmpeg-static يعيد المسار الصحيح حسب نظام التشغيل
    const staticPath = (await import("ffmpeg-static")).default as
      | string
      | null;

    if (staticPath) return staticPath;
  } catch {
    /* ffmpeg-static غير مثبت */
  }

  // التحقق من ffmpeg في PATH
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return "ffmpeg";
  } catch {
    throw new Error(
      "ffmpeg غير متوفر على الخادم. ثبّته عبر: apt install ffmpeg أو أضف حزمة ffmpeg-static"
    );
  }
}

let ffmpegConfigured = false;

export async function ensureFfmpeg(): Promise<string> {
  if (ffmpegConfigured) return "ok";

  const ffmpegPath = await resolveFfmpegPath();
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpegConfigured = true;

  console.log(`[FFmpeg] استخدام ffmpeg من: ${ffmpegPath}`);

  return "ok";
}

/* =========================================================
   توحيد مسارات الملفات لصيغة POSIX (شرطات مائلة للأمام)
   - ffmpeg وقارئ الـ concat بيكسّروا المسارات اللي فيها \ (يعتبرها
     محارف تهريب) — فبيتحول '\tmp\x\seg.mp4' إلى 'tmpxseg.mp4'
     وده سبب خطأ "No such file or directory" على ويندوز
   - المسارات بشرطات مائلة للأمام شغالة على كل الأنظمة
========================================================= */

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/* =========================================================
   استخراج الصوت من الفيديو → WAV 16kHz أحادي (للنسخ)
========================================================= */

export async function extractAudioFromVideo(
  videoPath: string,
  outputPath: string
): Promise<string> {
  await ensureFfmpeg();

  return new Promise((resolve, reject) => {
    ffmpeg(toPosix(videoPath))
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .on("end", () => resolve(outputPath))
      .on("error", (error) => reject(error))
      .save(toPosix(outputPath));
  });
}

/* =========================================================
   أدوات إضافية لتجميع فيديو الدروس
========================================================= */

/**
 * تحويل شريحة PNG + مقطع WAV إلى مقطع فيديو MP4
 */
export async function renderSlideVideo(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  options: { width?: number; height?: number; fps?: number } = {}
): Promise<string> {
  await ensureFfmpeg();

  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const fps = options.fps ?? 24;

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(toPosix(imagePath))
      .inputOptions(["-loop", "1", "-framerate", String(fps)])
      .input(toPosix(audioPath))
      .videoCodec("libx264")
      .videoFilters([`scale=${width}:${height}`, "format=yuv420p"])
      .outputOptions([
        "-preset",
        "veryfast",
        "-tune",
        "stillimage",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-shortest",
        "-movflags",
        "+faststart",
      ])
      .on("end", () => resolve(outputPath))
      .on("error", (error) => reject(new Error(`فشل تصيير مقطع الشريحة: ${error.message}`)))
      .save(toPosix(outputPath));
  });
}

/**
 * دمج عدة مقاطع MP4 بنفس المواصفات في ملف واحد
 * المحاولة الأولى: concat demuxer سريع (نسخ بدون إعادة ترميز)
 * لو فشلت: إعادة ترميز عبر filter_complex بدون أي ملف قوائم
 */
export async function concatVideos(
  segmentPaths: string[],
  outputPath: string
): Promise<string> {
  await ensureFfmpeg();

  if (segmentPaths.length === 0) {
    throw new Error("لا توجد مقاطع للدمج");
  }

  const { writeFile, rm } = await import("fs/promises");
  const listPath = outputPath + ".txt";

  /* مهم: مسارات المراتب داخل قائمة الـ concat بشرطات مائلة للأمام
     — الباك سلاش بيتاكل كمحرف تهريب ويبوظ المسار (خاصة على ويندوز) */
  const listContent = segmentPaths
    .map((p) => `file '${toPosix(p).replace(/'/g, "'\\''")}'`)
    .join("\n");

  await writeFile(listPath, listContent, "utf-8");

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(toPosix(listPath))
      .inputOptions(["-f", "concat", "-safe", "0"])
      .videoCodec("copy")
      .audioCodec("copy")
      .outputOptions(["-movflags", "+faststart"])
      .on("end", async () => {
        await rm(listPath, { force: true });
        resolve(outputPath);
      })
      .on("error", async (error) => {
        await rm(listPath, { force: true });
        console.error(
          "[FFmpeg] فشل الدمج السريع، جاري إعادة الترميز كحل بديل:",
          error.message
        );
        // المحاولة الثانية: إعادة ترميز كاملة بدون ملف قوائم (أكثر توافقًا)
        try {
          await reencodeConcat(segmentPaths, outputPath);
          resolve(outputPath);
        } catch (reError) {
          reject(
            reError instanceof Error
              ? reError
              : new Error("فشل دمج مقاطع الفيديو")
          );
        }
      })
      .save(toPosix(outputPath));
  });
}

/**
 * دمج بإعادة ترميز عبر filter_complex مباشرة — بدون أي ملف قوائم
 * (مناعة كاملة ضد مشاكل تهريب المسارات في قوائم الـ concat)
 */
async function reencodeConcat(
  segmentPaths: string[],
  outputPath: string
): Promise<string> {
  const MAX_DIRECT_INPUTS = 12;

  /* مقاطع كتيرة جدًا → نرجع لقائمة الـ concat (المسارات متصلحة بـ toPosix) */
  if (segmentPaths.length > MAX_DIRECT_INPUTS) {
    return concatListReencode(segmentPaths, outputPath);
  }

  return new Promise((resolve, reject) => {
    let builder = ffmpeg();

    for (const p of segmentPaths) {
      builder = builder.input(toPosix(p));
    }

    const n = segmentPaths.length;
    const W = 1280;
    const H = 720;

    /* نطبّع كل مقطع (المقاس + معدل الإطارات + الصوت) قبل الدمج
       — عشان الـ concat يشتغل حتى لو المقاطع مختلفة المواصفات */
    const normalize = segmentPaths
      .map(
        (_, i) =>
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}];` +
          `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}];`
      )
      .join("");

    const concatIn = segmentPaths
      .map((_, i) => `[v${i}][a${i}]`)
      .join("");

    builder
      .complexFilter(
        `${normalize}${concatIn}concat=n=${n}:v=1:a=1[vout][aout]`
      )
      .outputOptions([
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
      ])
      .on("end", () => resolve(outputPath))
      .on("error", (error) =>
        reject(new Error(`فشل دمج مقاطع الفيديو: ${error.message}`))
      )
      .save(toPosix(outputPath));
  });
}

/**
 * دمج بإعادة ترميز عبر قائمة concat (لأعداد المقاطع الكبيرة)
 */
async function concatListReencode(
  segmentPaths: string[],
  outputPath: string
): Promise<string> {
  const { writeFile, rm } = await import("fs/promises");
  const listPath = outputPath + ".r.txt";

  const listContent = segmentPaths
    .map((p) => `file '${toPosix(p).replace(/'/g, "'\\''")}'`)
    .join("\n");

  await writeFile(listPath, listContent, "utf-8");

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(toPosix(listPath))
      .inputOptions(["-f", "concat", "-safe", "0"])
      .videoCodec("libx264")
      .videoFilters(["format=yuv420p"])
      .audioCodec("aac")
      .outputOptions([
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
      ])
      .on("end", async () => {
        await rm(listPath, { force: true });
        resolve(outputPath);
      })
      .on("error", async (error) => {
        await rm(listPath, { force: true });
        reject(new Error(`فشل دمج مقاطع الفيديو: ${error.message}`));
      })
      .save(toPosix(outputPath));
  });
}

/**
 * قياس مدة ملف فيديو/صوت فعليًا عبر ffprobe
 */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  try {
    const ffprobePath = (await import("ffprobe-static")).default?.path || "ffprobe";

    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 30_000 }
    );

    const duration = parseFloat(stdout.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

/**
 * تحويل PCM خام إلى ملف WAV على القرص (يستخدمه مولّد الفيديو)
 */
export async function writePcmAsWav(
  pcm: Buffer,
  outputPath: string,
  sampleRate = 24_000
): Promise<string> {
  const { pcmToWav } = await import("@/lib/wav");
  const wav = pcmToWav(pcm, sampleRate, 1, 16);

  const { writeFile } = await import("fs/promises");
  await writeFile(outputPath, wav);

  return outputPath;
}

/**
 * استخراج أول إطار من فيديو كصورة (يستخدمه وضع Veo للمعاينة)
 */
export async function extractVideoFirstFrame(
  videoPath: string,
  outputPath: string
): Promise<string> {
  await ensureFfmpeg();

  return new Promise((resolve, reject) => {
    ffmpeg(toPosix(videoPath))
      .outputOptions(["-vframes", "1", "-vf", "scale=1280:720"])
      .on("end", () => resolve(outputPath))
      .on("error", (error) => reject(error))
      .save(toPosix(outputPath));
  });
}

export function fileExtension(name: string): string {
  return path.extname(name).toLowerCase();
}
