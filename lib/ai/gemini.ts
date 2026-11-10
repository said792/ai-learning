import { GoogleGenAI } from "@google/genai";

/* =========================================================
   عميل Gemini الموحد — نقطة واحدة لكل استدعاءات الذكاء الاصطناعي
   - برجَي مفاتيح منفصلان: مجاني (Free) ومدفوع (Paid/VIP)
   - تدوير تلقائي داخل كل برج + ملجأ أخير بين البرجين
   - كل الموديلات تُقرأ من متغيرات البيئة
========================================================= */

/* =========================================================
   Models (env-driven)
========================================================= */

export const MODELS = {
  // الموديل الرئيسي للتحليل والشات والـ OCR واختيار التصنيفات
  main: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite",
  // موديل تحويل النص إلى كلام
  tts: process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts",
  // موديل توليد الفيديو (Veo)
  video: process.env.GEMINI_VIDEO_MODEL?.trim() || "veo-3.1-fast-generate-001",
} as const;

/* =========================================================
   API Keys Pool — برجَي مفاتيح منفصلان:
   - برج المجانيين : GEMINI_API_KEY_1..N       (مفاتيح مجانية — للضيوف والمجانيين)
   - برج المدفوعين : GEMINI_PAID_API_KEY_1..N  (مفاتيح من مشاريع Google Cloud عليها فاتورة)

   القاعدة:
   - المجاني/الضيف لا يلمس مفاتيح الفلوس أبدًا.
   - المدفوع يستخدم برج الفاتورة أولًا، ولو فشل بالكامل يرجع للبرج المجاني كملجأ
     (الأولوية إن الدرس يتولد قدام العميل اللي دفع مهما حصل).
   - بدون مفاتيح مدفوعة في .env.local؟ كل حاجة تشتغل زي الأول — صفر كسر.
   تذكير مهم: حصة Google تُحسب على مستوى المشروع (Project) وليس المفتاح،
   لذا وزّع المفاتيح على مشاريع مختلفة لمضاعفة الحصص.
========================================================= */

export type GeminiTier = "free" | "paid";

const MAX_API_KEYS = 50;
const MAX_RETRIES_PER_KEY = 2; // أخطاء عابرة (شبكة/رد فاضي) — نفس المفتاح
const RETRY_BASE_DELAY_MS = 1_500;

/* إعدادات التعامل مع 429 (حد الاستخدام المؤقت من Google):
   بدل ما نحرق كل المفاتيح في ثواني، نستنى شوية ونجرب نفس المفتاح تاني */
const RATE_LIMIT_RETRIES_PER_KEY = 2;
const RATE_LIMIT_BASE_DELAY_MS = 6_000;
const RATE_LIMIT_MAX_WAIT_MS = 25_000; // أقصى انتظار للمحاولة الواحدة
const RATE_LIMIT_MAX_WAITS = 4; // إجمالي مرات الانتظار لكل نداء (حماية من التعليق)

/** قراءة مفاتيح برج معين (الافتراضي: برج المجانيين — للتوافق مع أي كود قديم) */
export function getGeminiKeys(tier: GeminiTier = "free"): string[] {
  const prefix = tier === "paid" ? "GEMINI_PAID_API_KEY_" : "GEMINI_API_KEY_";
  const legacyName = tier === "paid" ? "GEMINI_PAID_API_KEY" : "GEMINI_API_KEY";

  const keys: string[] = [];

  for (let i = 1; i <= MAX_API_KEYS; i++) {
    const key = process.env[`${prefix}${i}`];
    if (key && key.trim() !== "") keys.push(key.trim());
  }

  // مفتاح قديم بدون رقم (للتوافق)
  const legacy = process.env[legacyName];
  if (legacy && legacy.trim() !== "") keys.push(legacy.trim());

  return keys;
}

/** هل فيه مفاتيح مدفوعة متسجلة في .env.local؟ */
export function hasPaidKeys(): boolean {
  return getGeminiKeys("paid").length > 0;
}

/* تصنيف الأخطاء:
   - حد استخدام مؤقت (429) → يستنى ويعيد المحاولة
   - مفتاح مرفوض/غلط (401/403/malformed) → يتخطاه فورًا
   - أخطاء عابرة → إعادة محاولة سريعة بنفس المفتاح */
export function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("resource exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  );
}

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key expired") ||
    lower.includes("permission denied") ||
    lower.includes("403") ||
    lower.includes("401") ||
    lower.includes("unauthenticated") ||
    lower.includes("unregistered") ||
    lower.includes("consumer has been suspended")
  );
}

/* للتوافق مع أي كود قديم */
export function isKeyLevelError(message: string): boolean {
  return isRateLimitError(message) || isAuthError(message);
}

/** قراءة مدة الانتظار اللي جوجل بتطلبها في رسالة 429 (مثلًا "Please retry in 32s") */
function parseRetryDelayMs(message: string): number | null {
  const m =
    message.match(/retryDelay"?[:\s]*"?(\d+(?:\.\d+)?)s/i) ||
    message.match(/retry in (\d+(?:\.\d+)?)s/i) ||
    message.match(/after (\d+(?:\.\d+)?)s/i);

  if (!m) return null;

  const s = parseFloat(m[1]);
  return Number.isFinite(s) ? Math.round(s * 1000) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GeminiFailureKind = "rate_limit" | "auth" | "other";

export class AllKeysExhaustedError extends Error {
  readonly kind: GeminiFailureKind;
  readonly lastError: string;

  constructor(lastError: string, kind: GeminiFailureKind) {
    super(lastError);
    this.name = "AllKeysExhaustedError";
    this.lastError = lastError;
    this.kind = kind;
  }
}

/** رسالة مفهومة للمستخدم النهائي حسب نوع الفشل */
export function friendlyGeminiError(kind: GeminiFailureKind): string {
  if (kind === "rate_limit") {
    return (
      "مفاتيح الذكاء الاصطناعي (Gemini) وصلت للحد المؤقت للاستخدام من جوجل " +
      "(429 Resource Exhausted). دا بيحصل مع الحصص المشتركة بين المفاتيح. " +
      "استنى دقيقة أو اتنين وجرب تاني — ولو المشكلة بتتكرر كتير، وزّع مفاتيحك " +
      "على أكتر من مشروع Google Cloud مختلف عشان كل مشروع ليه حصة منفصلة " +
      "(الحصة بتتحسب على المشروع مش المفتاح). ولو عندك مفاتيح مدفوعة " +
      "(GEMINI_PAID_API_KEY) تأكد إنها متسجلة ومفعّلة في .env.local."
    );
  }

  if (kind === "auth") {
    return (
      "كل مفاتيح Gemini في ملف .env.local مرفوضة (مفتاح غلط أو ملغي). " +
      "راجع المتغيرات GEMINI_API_KEY_1..N وتأكد إنها صالحة من Google AI Studio."
    );
  }

  return "فشل الاتصال بخدمة الذكاء الاصطناعي على كل المفاتيح. تأكد من الاتصال بالإنترنت وحاول تاني.";
}

/* =========================================================
   تشغيل أي مهمة مع تدوير المفاتيح وإعادة المحاولة
========================================================= */

/* مؤشر تدوير لاصق لكل برج على حدة: كل نداء ناجح بيبدأ الدورة اللي بعده
   من المفتاح اللي بعده — بدل ما كل النداءات تضرب نفس المفتاح الأول */
const rotationCursors: Record<GeminiTier, number> = { free: 0, paid: 0 };

const POOL_LABEL: Record<GeminiTier, string> = {
  free: "برج المجانيين",
  paid: "برج المدفوعين",
};

type KeyPool = { tier: GeminiTier; keys: string[] };

/* ترتيب البرجين حسب تير النداء:
   - paid → البرج المدفوع أولًا والمجاني ملجأ أخير (الدرس يتولد مهما حصل)
   - free → البرج المجاني فقط (مفاتيح الفلوس محمية) */
function selectPools(tier: GeminiTier): KeyPool[] {
  const freeKeys = getGeminiKeys("free");
  const paidKeys = getGeminiKeys("paid");

  if (tier === "paid" && paidKeys.length > 0) {
    const pools: KeyPool[] = [{ tier: "paid", keys: paidKeys }];

    if (freeKeys.length > 0) pools.push({ tier: "free", keys: freeKeys });

    return pools;
  }

  return freeKeys.length > 0 ? [{ tier: "free", keys: freeKeys }] : [];
}

/* تشغيل المهمة على برج واحد — دورة تدوير كاملة على مفاتيحه بميزانية انتظار مستقلة */
async function runPool<T>(
  pool: KeyPool,
  task: (client: GoogleGenAI, apiKey: string) => Promise<T>,
  options: { retriesPerKey: number; baseDelayMs: number }
): Promise<T> {
  const { keys } = pool;
  const startIndex = rotationCursors[pool.tier] % keys.length;
  let lastError = "unknown";
  let lastKind: GeminiFailureKind = "other";
  let rateLimitWaits = 0; // ميزانية الانتظار الإجمالية لهذا النداء على هذا البرج

  for (let i = 0; i < keys.length; i++) {
    const idx = (startIndex + i) % keys.length;
    const apiKey = keys[idx];
    const client = new GoogleGenAI({ apiKey });

    for (let attempt = 1; attempt <= Math.max(options.retriesPerKey, 1); attempt++) {
      try {
        const result = await task(client, apiKey);

        // نجاح → النداء الجاي على هذا البرج يبدأ من المفتاح اللي بعده (توزيع الحمل)
        rotationCursors[pool.tier] = (idx + 1) % keys.length;

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        lastError = message;

        console.error(
          `[Gemini] (${POOL_LABEL[pool.tier]}) فشل (المفتاح #${idx + 1}، محاولة ${attempt}): ${message.substring(0, 200)}`
        );

        // ===== مفتاح مرفوض/غلط → المفتاح اللي بعده فورًا =====
        if (isAuthError(message)) {
          lastKind = "auth";
          break;
        }

        // ===== 429 حد استخدام مؤقت → استنى (حسب طلب جوجل) وجرب نفس المفتاح =====
        if (isRateLimitError(message)) {
          lastKind = "rate_limit";

          if (
            rateLimitWaits < RATE_LIMIT_MAX_WAITS &&
            attempt <= RATE_LIMIT_RETRIES_PER_KEY
          ) {
            const hint = parseRetryDelayMs(message);
            const wait = Math.min(
              hint ?? RATE_LIMIT_BASE_DELAY_MS * attempt,
              RATE_LIMIT_MAX_WAIT_MS
            );

            rateLimitWaits++;
            console.warn(
              `[Gemini] (${POOL_LABEL[pool.tier]}) المفتاح #${idx + 1} وصل للحد المؤقت — انتظار ${(wait / 1000).toFixed(0)}s قبل إعادة المحاولة`
            );
            await sleep(wait);
            continue; // نفس المفتاح، محاولة تانية
          }

          break; // خلصنا محاولات الانتظار → المفتاح اللي بعده
        }

        // ===== خطأ عابر (شبكة/رد فاضي) → إعادة سريعة بنفس المفتاح =====
        lastKind = "other";
        if (attempt < options.retriesPerKey) {
          await sleep(options.baseDelayMs * attempt);
        }
      }
    }
  }

  throw new AllKeysExhaustedError(lastError, lastKind);
}

export async function withKeyRotation<T>(
  task: (client: GoogleGenAI, apiKey: string) => Promise<T>,
  options: {
    retriesPerKey?: number;
    baseDelayMs?: number;
    /** أي برج مفاتيح؟ "paid" = برج الفاتورة أولًا + ملجأ مجاني (الافتراضي: المجاني فقط) */
    tier?: GeminiTier;
  } = {}
): Promise<T> {
  const tier: GeminiTier = options.tier === "paid" ? "paid" : "free";
  const pools = selectPools(tier);

  if (pools.length === 0) {
    throw new Error(
      "لا يوجد GEMINI_API_KEY في متغيرات البيئة. أضف GEMINI_API_KEY_1 على الأقل في .env.local"
    );
  }

  const retriesPerKey = options.retriesPerKey ?? MAX_RETRIES_PER_KEY;
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;

  if (tier === "paid") {
    const paidCount = pools[0].keys.length;
    const freeFallback = pools.length > 1 ? ` + ملجأ مجاني (${pools[1].keys.length} مفتاح)` : "";

    if (hasPaidKeys()) {
      console.log(`[Gemini] tier=paid → ${POOL_LABEL.paid} (${paidCount} مفتاح)${freeFallback}`);
    }
    // لو مفيش مفاتيح مدفوعة متسجلة، selectPools رجّعت المجاني فقط — تشغيل طبيعي بدون دروج
  }

  /* تجربة البرجين بالترتيب — لو البرج الأساسي فشل بالكامل نحاول الملجأ */
  const failures: AllKeysExhaustedError[] = [];

  for (let p = 0; p < pools.length; p++) {
    try {
      return await runPool(pools[p], task, { retriesPerKey, baseDelayMs });
    } catch (error) {
      if (error instanceof AllKeysExhaustedError) {
        failures.push(error);
        continue; // البرج الجاي (الملجأ)
      }
      throw error;
    }
  }

  /* كل البرجين فشلوا — نجمع تشخيص واضح */
  const combined = failures
    .map((f, i) => `[${POOL_LABEL[pools[i].tier]}] ${f.lastError}`)
    .join(" | ");

  throw new AllKeysExhaustedError(combined, failures[failures.length - 1].kind);
}

/* =========================================================
   استخراج النص من رد Gemini بأمان
========================================================= */

export function extractText(response: unknown): string {
  try {
    const r = response as {
      text?: string;
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    if (typeof r?.text === "string" && r.text.trim()) return r.text;

    const parts = r?.candidates?.[0]?.content?.parts || [];
    const joined = parts
      .map((p) => p.text || "")
      .join("")
      .trim();

    return joined;
  } catch {
    return "";
  }
}

/* =========================================================
   توليد نص بسيط
========================================================= */

export async function generateText(
  prompt: string,
  options: {
    systemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    tier?: GeminiTier;
  } = {}
): Promise<string> {
  return withKeyRotation(
    async (client) => {
    const response = await client.models.generateContent({
      model: MODELS.main,
      contents: prompt,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
      },
    });

    const text = extractText(response);

    if (!text) {
      throw new Error("رد فارغ من Gemini");
    }

    return text;
    },
    { tier: options.tier }
  );
}

/* =========================================================
   توليد JSON منظم مع Schema
========================================================= */

export async function generateJSON<T = unknown>(
  prompt: string,
  schema: Record<string, unknown>,
  options: {
    systemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    tier?: GeminiTier;
  } = {}
): Promise<T> {
  return withKeyRotation(
    async (client) => {
    const response = await client.models.generateContent({
      model: MODELS.main,
      contents: prompt,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const text = extractText(response);

    if (!text) {
      throw new Error("رد فارغ من Gemini");
    }

    return JSON.parse(text) as T;
    },
    { tier: options.tier }
  );
}

/* =========================================================
   Vision: تحليل صورة (inline base64)
========================================================= */

export async function visionText(
  prompt: string,
  image: { mimeType: string; data: Buffer },
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    tier?: GeminiTier;
  } = {}
): Promise<string> {
  return withKeyRotation(
    async (client) => {
    const response = await client.models.generateContent({
      model: MODELS.main,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: image.mimeType,
                data: image.data.toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
      },
    });

    const text = extractText(response);

    if (!text) {
      throw new Error("رد فارغ من Gemini");
    }

    return text;
    },
    { tier: options.tier }
  );
}

/* =========================================================
   OCR: استخراج النص من صورة/مستند ممسوح
========================================================= */

export async function ocrImage(
  image: { mimeType: string; data: Buffer },
  lang: "ar" | "en" = "ar"
): Promise<string> {
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

  return visionText(prompt, image, { temperature: 0.1 });
}

/* =========================================================
   Files API: رفع ملف (صوت/فيديو) للنسخ
========================================================= */

export async function uploadFileToGemini(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
  displayName = "media"
): Promise<{ uri: string; name: string; mimeType: string }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    displayName
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
    uri: data.file.uri,
    name: data.file.name,
    mimeType: data.file.mimeType,
  };
}

export async function pollFileStatus(
  fileName: string,
  apiKey: string,
  maxAttempts = 60,
  intervalMs = 5_000
): Promise<void> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    await sleep(intervalMs);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      { headers: { "x-goog-api-key": apiKey } }
    );

    if (!res.ok) {
      attempts++;
      continue;
    }

    const data = await res.json();

    if (data.state === "ACTIVE") return;

    if (data.state === "FAILED") {
      throw new Error("فشل معالجة الملف الصوتي في Gemini: FAILED");
    }

    attempts++;
  }

  throw new Error("انتهت مهلة الانتظار لمعالجة الملف الصوتي");
}

export async function deleteGeminiFile(
  fileName: string,
  apiKey: string
): Promise<void> {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
      { method: "DELETE", headers: { "x-goog-api-key": apiKey } }
    );
  } catch {
    /* silent cleanup */
  }
}

/* =========================================================
   نسخ الوسائط إلى نص (صوت/فيديو)
========================================================= */

export const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  weba: "audio/webm",
  m4b: "audio/mp4",
};

export const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mkv: "video/x-matroska",
  m4v: "video/mp4",
  "3gp": "video/3gpp",
  flv: "video/x-flv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ts: "video/mp2t",
};

export async function transcribeMedia(
  buffer: Buffer,
  mimeType: string,
  lang: "ar" | "en" = "ar"
): Promise<string> {
  const prompt =
    lang === "ar"
      ? "قم بنسخ هذا الصوت بالكامل وبشكل دقيق. أخرج النص المنسوخ فقط بدون أي تعليقات إضافية أو ملاحظات أو طوابع زمنية أو تنسيق."
      : "Transcribe this audio completely and accurately. Output ONLY the transcribed text without any additional commentary, notes, timestamps, or formatting.";

  return withKeyRotation(async (client, apiKey) => {
    const uploaded = await uploadFileToGemini(
      buffer,
      mimeType,
      apiKey,
      "media-transcribe"
    );

    await pollFileStatus(uploaded.name, apiKey);

    try {
      const response = await client.models.generateContent({
        model: MODELS.main,
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  mimeType: uploaded.mimeType,
                  fileUri: uploaded.uri,
                },
              },
              { text: prompt },
            ],
          },
        ],
      });

      return extractText(response);
    } finally {
      await deleteGeminiFile(uploaded.name, apiKey);
    }
  });
}
