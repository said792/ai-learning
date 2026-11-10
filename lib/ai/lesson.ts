import { generateJSON, type GeminiTier } from "@/lib/ai/gemini";

/* =========================================================
   توليد سكريبت الدرس من محتوى المستند
   - الوضع "narration": شرح بصوت واحد
   - الوضع "podcast": حوار بين مقدمين
========================================================= */

export type LessonSection = {
  heading: string;
  /** النص الذي سينطق بالصوت */
  narration: string;
  /** نقاط العرض على الشريحة (3-5) */
  bullets: string[];
};

export type LessonScript = {
  title: string;
  sections: LessonSection[];
};

const MAX_SECTIONS = 12;
const MAX_NARRATION_CHARS = 900;

export type LessonDialect = "egyptian" | "msa";

export async function buildLessonScript(options: {
  documentText: string;
  analysisTitle?: string;
  analysisSummary?: string;
  lang: "ar" | "en";
  style: "narration" | "podcast";
  /** لهجة التعليق الصوتي — الافتراضي مصري (طلب المستخدم) */
  dialect?: LessonDialect;
  /** برج المفاتيح: "paid" = مفاتيح الفاتورة للعملاء المدفوعين */
  tier?: GeminiTier;
}): Promise<LessonScript> {
  const { documentText, analysisTitle, analysisSummary, lang, style } = options;
  const dialect: LessonDialect = options.dialect === "msa" ? "msa" : "egyptian";

  // نص الإدخال: نعتمد الملخص + أول أجزاء النص الأصلي
  const sourceText = [
    analysisTitle ? `العنوان: ${analysisTitle}` : "",
    analysisSummary ? `الملخص: ${analysisSummary}` : "",
    documentText.slice(0, 60_000),
  ]
    .filter(Boolean)
    .join("\n\n");

  /* التعليمات الخاصة باللهجة للعربي:
     - مصري (الافتراضي): التعليق المنطوق باللهجة المصرية البيضاء، والعناوين/النقاط فصحى مبسطة قصيرة
     - فصحى: كل حاجة فصحى مبسطة */
  const dialectInstructionAr =
    dialect === "egyptian"
      ? `لهجة التعليق (مهم جدًا):
- اكتب حقل narration (النص المنطوق) باللهجة المصرية العامية البيضاء — زي ما المُحاضر المصري بيتكلم في الفيديوهات التعليمية: قريبة من الفصحى ومفهومة لكل العرب، ومتشدة شوية بالكلام العامي الطبيعي.
- حقل heading و bullets خليهم فصحى مبسطة قصيرة (لأنها هتتنشر على الشرائح).`
      : `لهجة التعليق: كل النص بالعربية الفصحى المبسطة المريحة في السماع.`;

  const styleInstruction =
    style === "podcast"
      ? lang === "ar"
        ? `أسلوب: حوار بودكاست تعليمي بين مقدمين (مقدم يطرح الأسئلة والخبير يجيب ويشرح).
في الحقول narration اكتب الحوار بصيغة:
مقدم: [سؤال أو تعليق]
خبير: [إجابة وشرح]
اجعل الحوار طبيعيًا وممتعًا مع الحفاظ على دقة المعلومة العلمية.

${dialectInstructionAr}`
        : `Style: educational podcast dialogue between a host and an expert.
In narration field write:
Host: [question or comment]
Expert: [answer and explanation]`
      : lang === "ar"
        ? `أسلوب: شرح مباشر بصوت معلن واحد، بجمل واضحة ومفيدة تصلح للسماع.

${dialectInstructionAr}`
        : "Style: single narrator explaining directly with clear spoken sentences.";

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            narration: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
          },
          required: ["heading", "narration", "bullets"],
        },
      },
    },
    required: ["title", "sections"],
  };

  const prompt =
    lang === "ar"
      ? `حوّل المحتوى التعليمي التالي إلى سكريبت درس مسموع منظم.

${styleInstruction}

قواعد صارمة:
1. اقسم الدرس إلى أقسام (من 4 إلى ${MAX_SECTIONS} قسم) بحسب حجم المحتوى.
2. كل قسم: heading (عنوان قصير)، narration (النص المنطوق بحد أقصى ${MAX_NARRATION_CHARS} حرف)، bullets (من 3 إلى 5 نقاط للعرض على شريحة).
3. أول قسم يكون مقدمة ترحيبية قصيرة تعرض عنوان الدرس وما سيغطيه.
4. آخر قسم يكون خاتمة تلخص أهم النقاط.
5. الالتزام الكامل بمحتوى المصدر — لا تخترع معلومات غير موجودة.
6. لا تستخدم أي رموز Markdown أو رموز رياضية غريبة — نص منطوق صافٍ.
7. الأرقام والمعادلات اكتبها كما هي بشكل قابل للقراءة الصوتية.
8. اكتب narration بالعربية المطلوبة حسب تعليمات اللهجة أعلاه، وheading و bullets بالفصحى المبسطة.

المحتوى:
${sourceText}`
      : `Convert the following educational content into a spoken lesson script.

${styleInstruction}

Strict rules:
1. Divide into ${MAX_SECTIONS} sections max (4+ depending on content).
2. Each section: heading (short title), narration (spoken text, max ${MAX_NARRATION_CHARS} chars), bullets (3-5 slide points).
3. First section = brief welcoming intro presenting the lesson title and coverage.
4. Last section = conclusion summarizing key points.
5. Stick strictly to the source content — do not invent information.
6. No Markdown or weird math symbols — clean spoken text.
7. Write everything in English.

Content:
${sourceText}`;

  const parsed = await generateJSON<LessonScript>(
    prompt,
    schema,
    { temperature: 0.5, maxOutputTokens: 16_384, tier: options.tier }
  );

  // تنظيف وحدود
  const sections = (parsed.sections || [])
    .slice(0, MAX_SECTIONS)
    .map((s) => ({
      heading: (s.heading || "").trim().slice(0, 120),
      narration: (s.narration || "").trim().slice(0, MAX_NARRATION_CHARS * 1.5),
      bullets: (s.bullets || []).slice(0, 5).map((b) => String(b).trim().slice(0, 140)).filter(Boolean),
    }))
    .filter((s) => s.narration.length > 10);

  if (sections.length === 0) {
    throw new Error("فشل توليد سكريبت الدرس — أقسام فارغة");
  }

  return {
    title: (parsed.title || analysisTitle || "درس تعليمي").trim().slice(0, 150),
    sections,
  };
}
