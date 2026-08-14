import { GoogleGenAI } from "@google/genai";

/* =========================================================
   Types
========================================================= */

export type AnalysisLang = "ar" | "en";

export interface DocumentEntity {
  type:
    | "person"
    | "organization"
    | "location"
    | "date"
    | "number"
    | "money"
    | "concept"
    | "term"
    | "other";

  label: string;
  value: string;
  sensitive?: boolean;
}

export interface DocumentRule {
  title: string;
  description: string;
}

export interface DocumentProcedure {
  title: string;
  steps: string[];
}

export interface DocumentSetting {
  name: string;
  value: string;
  description: string;
}

export interface DocumentCalculation {
  name: string;
  description: string;
  formula?: string;
}

export interface LearningAnalysis {
  title: string;

  documentType: string;

  summary: string;

  subject: string;

  recipient: string;

  requester: string;

  locations: string[];

  entities: DocumentEntity[];

  topics: string[];

  rules: DocumentRule[];

  procedures: DocumentProcedure[];

  settings: DocumentSetting[];

  calculations: DocumentCalculation[];

  importantNotes: string[];

  keywords: string[];

  learningObjectives: string[];

  keyPoints: string[];

  examples: string[];

  questions: string[];

  commonMistakes: string[];

  definitions: {
    term: string;
    definition: string;
  }[];
}

/* =========================================================
   Gemini Configuration
========================================================= */

/*
 * اسم الموديل المستخدم للتحليل.
 *
 * لا تغيّر هذا إلى gemini-2.5-flash-lite.
 */
const GEMINI_MODEL =
  "gemini-3.1-flash-lite";

/*
 * الحد الأقصى للنص الذي سيتم إرساله في طلب واحد.
 *
 * إذا كان المستند أكبر من ذلك سيتم إرسال الجزء الأول فقط
 * مع تنبيه Gemini بأن النص تم اختصاره.
 */
const MAX_INPUT_CHARS = 120_000;

/*
 * عدد مرات المحاولة لكل مفتاح.
 *
 * مثال:
 *
 * KEY_1
 *  ├─ محاولة 1
 *  └─ محاولة 2
 *
 * ثم KEY_2 ...
 */
const MAX_RETRIES_PER_KEY = 2;

/*
 * أقصى عدد مفاتيح نبحث عنها.
 *
 * يمكنك وضع:
 *
 * GEMINI_API_KEY_1
 * GEMINI_API_KEY_2
 * ...
 * GEMINI_API_KEY_20
 *
 * أو أكثر إذا أردت.
 */
const MAX_API_KEYS = 50;

/*
 * وقت انتظار بسيط بين المحاولات.
 *
 * يتم زيادة الوقت تدريجيًا.
 */
const RETRY_BASE_DELAY_MS = 1_500;

/* =========================================================
   Multi-Key Gemini
========================================================= */

/**
 * قراءة جميع مفاتيح Gemini من .env.local
 *
 * يدعم:
 *
 * GEMINI_API_KEY_1
 * GEMINI_API_KEY_2
 * GEMINI_API_KEY_3
 * ...
 *
 * ويتم تجاهل أي مفتاح فارغ.
 */
function getGeminiApiKeys(): string[] {
  const keys: string[] = [];

  for (
    let index = 1;
    index <= MAX_API_KEYS;
    index++
  ) {
    const key =
      process.env[
        `GEMINI_API_KEY_${index}`
      ]?.trim();

    if (key) {
      keys.push(key);
    }
  }

  /*
   * دعم احتياطي للمفتاح القديم.
   *
   * لو كان عندك GEMINI_API_KEY فقط،
   * سيظل البرنامج يعمل.
   *
   * لكن الأفضل استخدام:
   *
   * GEMINI_API_KEY_1
   * GEMINI_API_KEY_2
   * ...
   */
  const legacyKey =
    process.env.GEMINI_API_KEY?.trim();

  if (
    legacyKey &&
    !keys.includes(legacyKey)
  ) {
    keys.push(legacyKey);
  }

  return keys;
}

/**
 * إنشاء Gemini Client باستخدام مفتاح محدد.
 */
function createGeminiClient(
  apiKey: string
): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
  });
}

/* =========================================================
   Learning Analysis JSON Schema
========================================================= */

const learningAnalysisSchema = {
  type: "object",

  properties: {
    title: {
      type: "string",
      description:
        "عنوان المستند أو الدرس كما يظهر في المحتوى. إذا لم يوجد عنوان واضح، استنتج عنوانًا مختصرًا من المحتوى دون اختلاق معلومات.",
    },

    documentType: {
      type: "string",
      description:
        "نوع المستند مثل درس، محاضرة، مذكرة، فصل تعليمي، ملخص، مراجعة، تمارين، شرح تعليمي، طلب رسمي، عقد، مستند عام.",
    },

    summary: {
      type: "string",
      description:
        "ملخص دقيق للمحتوى، مبني فقط على النص المرسل.",
    },

    subject: {
      type: "string",
      description:
        "المادة أو المجال التعليمي إذا أمكن تحديده من النص، وإلا اتركه فارغًا.",
    },

    recipient: {
      type: "string",
      description:
        "الشخص أو الجهة الموجه إليها المستند إذا وجدت، وإلا سلسلة فارغة.",
    },

    requester: {
      type: "string",
      description:
        "مقدم المستند أو مقدم الطلب إذا وجد، وإلا سلسلة فارغة.",
    },

    locations: {
      type: "array",

      items: {
        type: "string",
      },

      description:
        "الأماكن والمواقع المذكورة صراحة في المستند.",
    },

    entities: {
      type: "array",

      items: {
        type: "object",

        properties: {
          type: {
            type: "string",

            enum: [
              "person",
              "organization",
              "location",
              "date",
              "number",
              "money",
              "concept",
              "term",
              "other",
            ],
          },

          label: {
            type: "string",
          },

          value: {
            type: "string",
          },

          sensitive: {
            type: "boolean",
          },
        },

        required: [
          "type",
          "label",
          "value",
        ],
      },
    },

    topics: {
      type: "array",

      items: {
        type: "string",
      },

      description:
        "الموضوعات والمفاهيم التعليمية الموجودة فعليًا في المستند.",
    },

    rules: {
      type: "array",

      items: {
        type: "object",

        properties: {
          title: {
            type: "string",
          },

          description: {
            type: "string",
          },
        },

        required: [
          "title",
          "description",
        ],
      },
    },

    procedures: {
      type: "array",

      items: {
        type: "object",

        properties: {
          title: {
            type: "string",
          },

          steps: {
            type: "array",

            items: {
              type: "string",
            },
          },
        },

        required: [
          "title",
          "steps",
        ],
      },
    },

    settings: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string",
          },

          value: {
            type: "string",
          },

          description: {
            type: "string",
          },
        },

        required: [
          "name",
          "value",
          "description",
        ],
      },
    },

    calculations: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string",
          },

          description: {
            type: "string",
          },

          formula: {
            type: "string",
          },
        },

        required: [
          "name",
          "description",
        ],
      },
    },

    importantNotes: {
      type: "array",

      items: {
        type: "string",
      },
    },

    keywords: {
      type: "array",

      items: {
        type: "string",
      },
    },

    learningObjectives: {
      type: "array",

      items: {
        type: "string",
      },
    },

    keyPoints: {
      type: "array",

      items: {
        type: "string",
      },
    },

    examples: {
      type: "array",

      items: {
        type: "string",
      },
    },

    questions: {
      type: "array",

      items: {
        type: "string",
      },
    },

    commonMistakes: {
      type: "array",

      items: {
        type: "string",
      },
    },

    definitions: {
      type: "array",

      items: {
        type: "object",

        properties: {
          term: {
            type: "string",
          },

          definition: {
            type: "string",
          },
        },

        required: [
          "term",
          "definition",
        ],
      },
    },
  },

  required: [
    "title",
    "documentType",
    "summary",
    "subject",
    "recipient",
    "requester",
    "locations",
    "entities",
    "topics",
    "rules",
    "procedures",
    "settings",
    "calculations",
    "importantNotes",
    "keywords",
    "learningObjectives",
    "keyPoints",
    "examples",
    "questions",
    "commonMistakes",
    "definitions",
  ],
};

/* =========================================================
   Main Entry Point
========================================================= */

/**
 * نقطة الدخول الرئيسية لتحليل المستند.
 *
 * analyzeDocument()
 *       ↓
 * تنظيف النص
 *       ↓
 * Multi-Key Gemini
 *       ↓
 * Structured JSON
 *       ↓
 * Normalize
 *       ↓
 * LearningAnalysis
 */
export async function analyzeDocument(
  text: string,
  lang: AnalysisLang = "ar"
): Promise<LearningAnalysis> {
  const cleanText =
    cleanDocumentText(text);

  if (!cleanText) {
    return createEmptyAnalysis(lang);
  }

  return analyzeWithGemini(
    cleanText,
    lang
  );
}

/* =========================================================
   Gemini Analyzer - Multi Key
========================================================= */

async function analyzeWithGemini(
  text: string,
  lang: AnalysisLang
): Promise<LearningAnalysis> {
  const apiKeys =
    getGeminiApiKeys();

  /*
   * لا يوجد أي مفتاح.
   */
  if (apiKeys.length === 0) {
    throw new Error(
      "لم يتم العثور على أي مفتاح Gemini. أضف GEMINI_API_KEY_1 في ملف .env.local"
    );
  }

  /*
   * حماية من إرسال نص ضخم جدًا.
   */
  const inputText =
    text.length > MAX_INPUT_CHARS
      ? text.slice(
          0,
          MAX_INPUT_CHARS
        ) +
        (lang === "ar"
          ? "\n\n[تم اختصار نهاية المستند بسبب طول المحتوى]"
          : "\n\n[End of document truncated due to length]")
      : text;

  const prompt =
    buildAnalysisPrompt(
      inputText,
      lang
    );

  let lastError: unknown =
    null;

  /*
   * تجربة المفاتيح واحدًا تلو الآخر.
   *
   * إذا فشل KEY_1 بسبب:
   *
   * 429
   * quota
   * rate limit
   * resource exhausted
   *
   * ينتقل تلقائيًا إلى KEY_2.
   */
  for (
    let keyIndex = 0;
    keyIndex < apiKeys.length;
    keyIndex++
  ) {
    const apiKey =
      apiKeys[keyIndex];

    const keyNumber =
      keyIndex + 1;

    const ai =
      createGeminiClient(
        apiKey
      );

    console.log(
      `[Gemini] محاولة استخدام المفتاح رقم ${keyNumber} من ${apiKeys.length}`
    );

    for (
      let attempt = 1;
      attempt <= MAX_RETRIES_PER_KEY;
      attempt++
    ) {
      try {
        const result =
          await generateGeminiAnalysis(
            ai,
            prompt
          );

        console.log(
          `[Gemini] تم التحليل بنجاح باستخدام المفتاح رقم ${keyNumber}`
        );

        return result;
      } catch (error) {
        lastError =
          error;

        const errorMessage =
          getErrorMessage(
            error
          );

        console.error(
          `[Gemini] فشل المفتاح رقم ${keyNumber} - المحاولة ${attempt}/${MAX_RETRIES_PER_KEY}`,
          errorMessage
        );

        /*
         * إذا كان الخطأ يشير إلى أن المفتاح أو الحصة
         * غير متاحة، نترك هذا المفتاح وننتقل للمفتاح التالي.
         */
        if (
          isQuotaOrRateLimitError(
            error
          )
        ) {
          console.warn(
            `[Gemini] المفتاح رقم ${keyNumber} وصل إلى الحد أو معدل الطلبات. الانتقال للمفتاح التالي.`
          );

          break;
        }

        /*
         * أخطاء المصادقة:
         *
         * API key invalid
         * permission denied
         *
         * لا فائدة من إعادة المحاولة بنفس المفتاح.
         */
        if (
          isAuthenticationError(
            error
          )
        ) {
          console.warn(
            `[Gemini] المفتاح رقم ${keyNumber} غير صالح أو غير مصرح به. الانتقال للمفتاح التالي.`
          );

          break;
        }

        /*
         * الأخطاء الأخرى:
         *
         * نحاول مرة أخرى إذا لم نصل للحد.
         */
        if (
          attempt <
          MAX_RETRIES_PER_KEY
        ) {
          const delay =
            RETRY_BASE_DELAY_MS *
            attempt;

          console.log(
            `[Gemini] إعادة المحاولة بعد ${delay}ms...`
          );

          await sleep(
            delay
          );
        }
      }
    }
  }

  /*
   * جميع المفاتيح فشلت.
   */
  const finalMessage =
    getErrorMessage(
      lastError
    );

  throw new Error(
    `فشل تحليل المستند باستخدام جميع مفاتيح Gemini (${apiKeys.length}). آخر خطأ: ${finalMessage}`
  );
}

/* =========================================================
   Gemini Request
========================================================= */

async function generateGeminiAnalysis(
  ai: GoogleGenAI,
  prompt: string
): Promise<LearningAnalysis> {
  const response =
    await ai.models.generateContent(
      {
        model:
          GEMINI_MODEL,

        contents:
          prompt,

        config: {
          responseMimeType:
            "application/json",

          responseSchema:
            learningAnalysisSchema,
        },
      }
    );

  const raw =
    response.text?.trim();

  if (!raw) {
    throw new Error(
      "Gemini أعاد استجابة فارغة"
    );
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(raw);
  } catch {
    console.error(
      "Gemini returned invalid JSON:",
      raw
    );

    throw new Error(
      "استجابة Gemini ليست JSON صالح"
    );
  }

  return normalizeLearningAnalysis(
    parsed
  );
}

/* =========================================================
   Prompt
========================================================= */

function buildAnalysisPrompt(
  inputText: string,
  lang: AnalysisLang
): string {
  /*
   * ★ التعديل الأساسي:
   *
   * بدل ما نكتب "اللغة الأساسية هي العربية" مباشرة،
   * بنحدد اللغة بناءً على قيمة lang.
   */
  const langInstruction =
    lang === "en"
      ? `CRITICAL LANGUAGE RULE: You MUST generate the ENTIRE response in English ONLY. Every single field — title, summary, topics, rules, procedures, notes, calculations, questions, keywords, definitions, key points, examples, common mistakes, learning objectives, entity labels — ALL must be in English. Do NOT use any Arabic in the output values.`
      : `قاعدة اللغة الأساسية: يجب أن تكون اللغة الأساسية للإجابة هي العربية. جميع الحقول يجب أن تكون بالعربية.`;

  const truncationNote =
    lang === "en"
      ? "The document text below may have been truncated if it was too long."
      : "قد يكون نص المستند أدناه مختصرًا إذا كان طويلًا جدًا.";

  const baseRules =
    lang === "en"
      ? `
You are an intelligent document analysis and learning engine inside an educational system.

Your task is to analyze the attached document and return structured data ONLY.

Basic rules:

1. Rely ONLY on the document content.
2. Do NOT invent names, dates, numbers, rules, or information not present.
3. Do NOT add information from your general knowledge as if extracted from the document.
4. If a piece of information is not found, use an empty string or empty array.
5. Preserve the terminology used in the document.
6. ${langInstruction}
7. If the document is educational, focus on:
   - Lesson title
   - Subject
   - Topics
   - Definitions
   - Rules
   - Solution steps
   - Examples
   - Learning objectives
   - Key points
   - Questions
   - Common mistakes
   - Equations and calculations
8. If the document is not educational, do NOT force it to look like a lesson.
9. "recipient" should only contain the person or entity the document is addressed to, if present.
10. "requester" should only contain the submitter or applicant, if present.
11. "locations" should only contain places explicitly mentioned.
12. "entities" should extract actually important entities from the document.
13. sensitive = true ONLY when the information is clearly sensitive (e.g., national ID, highly personal data).
14. Do NOT repeat elements.
15. "definitions" should only contain terms and their definitions when supported by the text.
16. "calculations" should only contain equations or mathematical relationships actually present.
17. "procedures" should only contain actual steps found in the document, not made-up steps.
18. "learningObjectives":
   - Use explicitly stated objectives if present.
   - If no explicit objectives exist, you may formulate direct learning objectives from the content.
   - Do NOT add information not in the document.
19. "summary" should be useful and clear, not just a copy of the text.
20. "keywords" should be actually important words and terms from the document.
21. "topics" should represent the main topics present in the document.
22. "keyPoints" should represent the most important educational information the student needs to understand.
23. "examples" should only include examples found in the document.
24. "questions" can be extracted from questions in the document, or formulated as educational questions directly from the information present.
25. "commonMistakes" should NOT include invented errors. If no clear mistakes or warnings exist, return an empty array.
26. Do NOT repeat the same information in multiple elements unless necessary.
27. Do NOT write Markdown.
28. Return JSON matching the required schema exactly.
29. Do NOT add any text outside the JSON.

 ${truncationNote}
`
      : `
أنت محرك تحليل مستندات وتعليم ذكي داخل نظام تعليمي.

مهمتك تحليل المستند المرفق وإرجاع بيانات منظمة فقط.

قواعد أساسية جدًا:

1. اعتمد على محتوى المستند فقط.

2. لا تخترع أسماء أو تواريخ أو أرقام أو قواعد غير موجودة.

3. لا تضف معلومات من معرفتك العامة كأنها مستخرجة من المستند.

4. إذا لم تجد معلومة، استخدم قيمة فارغة أو قائمة فارغة.

5. حافظ على المصطلحات الموجودة في المستند.

6. ${langInstruction}

7. إذا كان المستند تعليميًا، ركز على:
   - عنوان الدرس
   - المادة
   - الموضوعات
   - التعريفات
   - القواعد
   - خطوات الحل
   - الأمثلة
   - أهداف التعلم
   - النقاط الأساسية
   - الأسئلة
   - الأخطاء الشائعة
   - المعادلات والحسابات

8. إذا كان المستند غير تعليمي، لا تحاول إجباره على أن يكون درسًا.

9. recipient يجب أن يحتوي فقط على الشخص أو الجهة الموجه إليها المستند إذا كانت موجودة.

10. requester يجب أن يحتوي فقط على مقدم المستند أو الطلب إذا كان موجودًا.

11. locations تحتوي فقط على الأماكن المذكورة فعليًا.

12. entities يجب أن تستخرج الكيانات المهمة فعليًا من المستند.

13. sensitive = true فقط عندما تكون المعلومة حساسة بوضوح مثل رقم قومي أو بيانات شخصية شديدة الحساسية.

14. لا تكرر العناصر.

15. definitions يجب أن تحتوي على مصطلح وتعريفه فقط عندما يكون التعريف مدعومًا من النص.

16. calculations يجب أن تحتوي على المعادلات أو العلاقات الرياضية الموجودة فعليًا.

17. procedures يجب أن تحتوي على خطوات فعلية موجودة في المستند، وليس خطوات من عندك.

18. learningObjectives:
   - استخدم الأهداف الموجودة فعليًا.
   - إذا لم توجد أهداف صريحة، يمكن صياغة أهداف تعليمية مباشرة من المحتوى.
   - لا تضف معلومات غير موجودة في المستند.

19. summary يجب أن يكون مفيدًا وواضحًا وليس مجرد نسخ للنص.

20. keywords يجب أن تكون كلمات ومصطلحات مهمة فعلًا من المستند.

21. topics يجب أن تمثل الموضوعات الرئيسية الموجودة في المستند.

22. keyPoints يجب أن تمثل أهم المعلومات التعليمية التي يحتاج الطالب إلى فهمها.

23. examples يجب أن تتضمن الأمثلة الموجودة في المستند فقط.

24. questions يمكن استخراجها من الأسئلة الموجودة في المستند، ويمكن صياغة أسئلة تعليمية مباشرة من المعلومات الموجودة في المستند.

25. commonMistakes يجب ألا تتضمن أخطاء مخترعة. إذا لم توجد أخطاء أو تحذيرات واضحة، أرجع قائمة فارغة.

26. لا تكرر نفس المعلومة في أكثر من عنصر إلا إذا كان ذلك ضروريًا.

27. لا تكتب Markdown.

28. أرجع JSON مطابقًا تمامًا للـ schema المطلوب.

29. لا تضف أي نص خارج JSON.

 ${truncationNote}
`;

  return `
 ${baseRules}

---------------- BEGIN DOCUMENT ----------------

 ${inputText}

----------------- END DOCUMENT -----------------
`;
}

/* =========================================================
   Error Detection
========================================================= */

/**
 * تحويل أي Error إلى رسالة مفهومة.
 */
function getErrorMessage(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
    "string"
  ) {
    return error;
  }

  try {
    return JSON.stringify(
      error
    );
  } catch {
    return String(error);
  }
}

/**
 * تحديد أخطاء الـ quota / rate limit.
 */
function isQuotaOrRateLimitError(
  error: unknown
): boolean {
  const message =
    getErrorMessage(
      error
    ).toLowerCase();

  return (
    message.includes(
      "429"
    ) ||
    message.includes(
      "resource_exhausted"
    ) ||
    message.includes(
      "resource exhausted"
    ) ||
    message.includes(
      "quota"
    ) ||
    message.includes(
      "rate limit"
    ) ||
    message.includes(
      "ratelimit"
    ) ||
    message.includes(
      "too many requests"
    ) ||
    message.includes(
      "limit exceeded"
    )
  );
}

/**
 * تحديد أخطاء المصادقة.
 */
function isAuthenticationError(
  error: unknown
): boolean {
  const message =
    getErrorMessage(
      error
    ).toLowerCase();

  return (
    message.includes(
      "401"
    ) ||
    message.includes(
      "403"
    ) ||
    message.includes(
      "unauthorized"
    ) ||
    message.includes(
      "permission denied"
    ) ||
    message.includes(
      "api key not valid"
    ) ||
    message.includes(
      "invalid api key"
    ) ||
    message.includes(
      "api_key_invalid"
    )
  );
}

/* =========================================================
   Delay
========================================================= */

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

/* =========================================================
   Normalize Gemini Result
========================================================= */

function normalizeLearningAnalysis(
  value: unknown
): LearningAnalysis {
  const data =
    isRecord(value)
      ? value
      : {};

  return {
    title:
      getString(
        data.title
      ),

    documentType:
      getString(
        data.documentType
      ),

    summary:
      getString(
        data.summary
      ),

    subject:
      getString(
        data.subject
      ),

    recipient:
      getString(
        data.recipient
      ),

    requester:
      getString(
        data.requester
      ),

    locations:
      getStringArray(
        data.locations
      ),

    entities:
      normalizeEntities(
        data.entities
      ),

    topics:
      getStringArray(
        data.topics
      ),

    rules:
      normalizeRules(
        data.rules
      ),

    procedures:
      normalizeProcedures(
        data.procedures
      ),

    settings:
      normalizeSettings(
        data.settings
      ),

    calculations:
      normalizeCalculations(
        data.calculations
      ),

    importantNotes:
      getStringArray(
        data.importantNotes
      ),

    keywords:
      getStringArray(
        data.keywords
      ),

    learningObjectives:
      getStringArray(
        data.learningObjectives
      ),

    keyPoints:
      getStringArray(
        data.keyPoints
      ),

    examples:
      getStringArray(
        data.examples
      ),

    questions:
      getStringArray(
        data.questions
      ),

    commonMistakes:
      getStringArray(
        data.commonMistakes
      ),

    definitions:
      normalizeDefinitions(
        data.definitions
      ),
  };
}

/* =========================================================
   Entity Normalizer
========================================================= */

function normalizeEntities(
  value: unknown
): DocumentEntity[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const allowedTypes =
    new Set<
      DocumentEntity["type"]
    >([
      "person",
      "organization",
      "location",
      "date",
      "number",
      "money",
      "concept",
      "term",
      "other",
    ]);

  const result: DocumentEntity[] =
    [];

  for (
    const item of value
  ) {
    if (
      !isRecord(item)
    ) {
      continue;
    }

    const rawType =
      getString(
        item.type
      ) as DocumentEntity["type"];

    const type =
      allowedTypes.has(
        rawType
      )
        ? rawType
        : "other";

    const label =
      getString(
        item.label
      );

    const entityValue =
      getString(
        item.value
      );

    if (
      !entityValue
    ) {
      continue;
    }

    result.push({
      type,

      label:
        label ||
        "Entity",

      value:
        entityValue,

      sensitive:
        typeof item.sensitive ===
        "boolean"
          ? item.sensitive
          : undefined,
    });
  }

  return uniqueEntities(
    result
  ).slice(
    0,
    100
  );
}

/* =========================================================
   Rules Normalizer
========================================================= */

function normalizeRules(
  value: unknown
): DocumentRule[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (item) => ({
        title:
          getString(
            item.title
          ),

        description:
          getString(
            item.description
          ),
      })
    )
    .filter(
      (item) =>
        item.title ||
        item.description
    )
    .slice(
      0,
      50
    );
}

/* =========================================================
   Procedures Normalizer
========================================================= */

function normalizeProcedures(
  value: unknown
): DocumentProcedure[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (item) => ({
        title:
          getString(
            item.title
          ),

        steps:
          getStringArray(
            item.steps
          ),
      })
    )
    .filter(
      (item) =>
        item.title ||
        item.steps.length
    )
    .slice(
      0,
      30
    );
}

/* =========================================================
   Settings Normalizer
========================================================= */

function normalizeSettings(
  value: unknown
): DocumentSetting[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (item) => ({
        name:
          getString(
            item.name
          ),

        value:
          getString(
            item.value
          ),

        description:
          getString(
            item.description
          ),
      })
    )
    .filter(
      (item) =>
        item.name ||
        item.value ||
        item.description
    )
    .slice(
      0,
      50
    );
}

/* =========================================================
   Calculations Normalizer
========================================================= */

function normalizeCalculations(
  value: unknown
): DocumentCalculation[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (item) => {
        const calculation:
          DocumentCalculation =
          {
            name:
              getString(
                item.name
              ),

            description:
              getString(
                item.description
              ),
          };

        const formula =
          getString(
            item.formula
          );

        if (
          formula
        ) {
          calculation.formula =
            formula;
        }

        return calculation;
      }
    )
    .filter(
      (item) =>
        item.name ||
        item.description ||
        item.formula
    )
    .slice(
      0,
      50
    );
}

/* =========================================================
   Definitions Normalizer
========================================================= */

function normalizeDefinitions(
  value: unknown
): {
  term: string;
  definition: string;
}[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (item) => ({
        term:
          getString(
            item.term
          ),

        definition:
          getString(
            item.definition
          ),
      })
    )
    .filter(
      (item) =>
        item.term &&
        item.definition
    )
    .slice(
      0,
      50
    );
}

/* =========================================================
   Generic Helpers
========================================================= */

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(
      value
    )
  );
}

function getString(
  value: unknown
): string {
  if (
    typeof value ===
    "string"
  ) {
    return value.trim();
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
    "boolean"
  ) {
    return String(value);
  }

  return "";
}

function getStringArray(
  value: unknown
): string[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return uniqueStrings(
    value
      .map(
        getString
      )
      .filter(
        Boolean
      )
  );
}

function uniqueStrings(
  values: string[]
): string[] {
  return [
    ...new Set(
      values
        .map(
          (value) =>
            value.trim()
        )
        .filter(
          Boolean
        )
    ),
  ];
}

function uniqueEntities(
  entities: DocumentEntity[]
): DocumentEntity[] {
  const map =
    new Map<
      string,
      DocumentEntity
    >();

  for (
    const entity of entities
  ) {
    const key =
      `${entity.type}:${entity.value}`;

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        entity
      );
    }
  }

  return [
    ...map.values(),
  ];
}

/* =========================================================
   Text Cleaning
========================================================= */

function cleanDocumentText(
  text: string
): string {
  return text
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\u200f/g,
      ""
    )
    .replace(
      /\u200e/g,
      ""
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}

/* =========================================================
   Empty Result
========================================================= */

function createEmptyAnalysis(
  lang: AnalysisLang
): LearningAnalysis {
  return {
    title: "",

    documentType:
      lang === "en"
        ? "General Document"
        : "مستند عام",

    summary: "",

    subject: "",

    recipient: "",

    requester: "",

    locations: [],

    entities: [],

    topics: [],

    rules: [],

    procedures: [],

    settings: [],

    calculations: [],

    importantNotes: [],

    keywords: [],

    learningObjectives: [],

    keyPoints: [],

    examples: [],

    questions: [],

    commonMistakes: [],

    definitions: [],
  };
}