import {
  MODELS,
  withKeyRotation,
  extractText,
  type GeminiTier,
} from "@/lib/ai/gemini";

/* =========================================================
   تحويل النص إلى كلام (Gemini TTS)
   - يعيد مقاطع PCM خام (s16le / 24kHz / mono)
========================================================= */

export type TtsSpeaker = {
  speaker: string;
  voiceName: string;
};

export type TtsOptions = {
  // صوت واحد (الوضع: شرح)
  voiceName?: string;
  // أو متحدثون متعددون (الوضع: بودكاست)
  speakers?: TtsSpeaker[];
  temperature?: number;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين (الافتراضي: المجاني) */
  tier?: GeminiTier;
};

/* أصوات عربية جيدة في Gemini TTS */
export const TTS_VOICES = [
  { id: "Kore", label: "كوري — أنثى واثقة", hint: "مناسبة للشرح" },
  { id: "Puck", label: "بَك — ذكر حيوي", hint: "مناسبة للبودكاست" },
  { id: "Charon", label: "خارون — ذكر إخباري", hint: "صوت معلن" },
  { id: "Aoede", label: "أويدي — أنثى هادئة", hint: "سرد مريح" },
  { id: "Fenrir", label: "فنرير — ذكر متحمس", hint: "طاقة عالية" },
  { id: "Leda", label: "ليدا — أنثى شابة", hint: "شرح خفيف" },
  { id: "Orus", label: "أوروس — ذكر حازم", hint: "مقدمات" },
  { id: "Zephyr", label: "زفير — أنثى مشرقة", hint: "مرحة" },
] as const;

/** أقصى عدد أحرف لكل نداء TTS (تقطيع تلقائي للنصوص الطويلة) */
const MAX_TTS_CHARS = 3_800;

/** تقسيم النص لمقاطع صالحة للتقطيع عند حدود الجُمل */
export function chunkTextForTts(text: string, maxChars = MAX_TTS_CHARS): string[] {
  const clean = text.trim();

  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let current = "";

  // نقاط التقطيع المفضلة: نهاية السؤال/التعجب، ثم النقطة، ثم الفاصلة
  const sentences = clean
    .split(/(?<=[.!?؟।\n])\s+/)
    .filter(Boolean);

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > maxChars) {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;

      // جملة واحدة أطول من الحد → تقطيع عنيف عند الفواصل
      while (current.length > maxChars) {
        let cut = current.lastIndexOf("،", maxChars);
        if (cut < maxChars * 0.5) cut = current.lastIndexOf(",", maxChars);
        if (cut < maxChars * 0.5) cut = maxChars;
        chunks.push(current.slice(0, cut).trim());
        current = current.slice(cut).trim();
      }
    } else {
      current = (current + " " + sentence).trim();
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.filter(Boolean);
}

function buildSpeechConfig(options: TtsOptions): Record<string, unknown> {
  if (options.speakers && options.speakers.length > 1) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: options.speakers.map((s) => ({
          speaker: s.speaker,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voiceName } },
        })),
      },
    };
  }

  return {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: options.voiceName || "Kore",
      },
    },
  };
}

/**
 * توليد صوت لنص واحد — يعيد مقاطع PCM
 */
export async function ttsToPcm(
  text: string,
  options: TtsOptions = {}
): Promise<Buffer> {
  const speechConfig = buildSpeechConfig(options);

  return withKeyRotation(async (client) => {
    const response = await client.models.generateContent({
      model: MODELS.tts,
      contents: text,
      config: {
        responseModalities: ["AUDIO"],
        temperature: options.temperature ?? 1.0,
        speechConfig,
      } as never,
    });

    const r = response as unknown as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string } }> };
      }>;
    };

    const parts = r?.candidates?.[0]?.content?.parts || [];
    const base64 = parts
      .map((p) => p.inlineData?.data || "")
      .join("");

    if (!base64) {
      const fallback = extractText(response);
      throw new Error(
        `لم يُرجع Gemini TTS أي صوت${fallback ? ` (رد نصي: ${fallback.substring(0, 120)})` : ""}`
      );
    }

    return Buffer.from(base64, "base64");
  }, { tier: options.tier });
}

/**
 * تحويل نص كامل (طويل) إلى PCM متصل مع تقطيع تلقائي
 */
export async function ttsLongTextToPcm(
  text: string,
  options: TtsOptions = {}
): Promise<{ pcm: Buffer; chunks: number }> {
  const chunks = chunkTextForTts(text);
  const pcmChunks: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[TTS] توليد المقطع الصوتي ${i + 1}/${chunks.length}...`);

    const pcm = await ttsToPcm(chunks[i], options);

    if (pcm.length > 0) {
      pcmChunks.push(pcm);
    }

    // مهلة صغيرة بين النداءات لتخفيف الضغط
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (pcmChunks.length === 0) {
    throw new Error("لم يتم توليد أي صوت للدرس");
  }

  return { pcm: Buffer.concat(pcmChunks), chunks: pcmChunks.length };
}
