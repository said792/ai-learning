import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * اقتراح كتالوج ذكي بناءً على محتوى الملف
 */
export async function suggestCategory(
  analysisText: string,
  existingCategories: string[],
  lang: "ar" | "en" = "ar"
): Promise<{ suggestedName: string | null; confidence: "high" | "medium" | "low" }> {
  const apiKey =
    process.env.GEMINI_API_KEY_1 ||
    process.env.GEMINI_API_KEY_2 ||
    process.env.GEMINI_API_KEY_3 ||
    process.env.GEMINI_API_KEY_4 ||
    process.env.GEMINI_API_KEY_5;

  if (!apiKey) {
    return { suggestedName: null, confidence: "low" };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const categoriesList =
      existingCategories.length > 0
        ? existingCategories.map((c, i) => `${i + 1}. ${c}`).join("\n")
        : "(لا توجد كتالوجات حالية)";

    const prompt =
      lang === "ar"
        ? `بناءً على التحليل التالي لمستند، اقترح الكتالوج الأنسب له.

الكتالوجات الموجودة:
 ${categoriesList}

تحليل المستند:
 ${analysisText.slice(0, 2000)}

أجب بصيغة JSON فقط:
{
  "category": "اسم الكتالوج المقترح",
  "isNew": true أو false (هل كتالوج جديد أم موجود بالفعل),
  "confidence": "high" أو "medium" أو "low"
}

قواعد:
- إذا كان المستند يناسب كتالوج موجود، استخدم اسمه بالضبط واجعل isNew = false
- إذا كان المستند يحتاج كتالوج جديد، اقترح اسم قصير وواضح واجعل isNew = true
- الاسم يجب أن يكون بالعربية`
        : `Based on the following document analysis, suggest the most appropriate category.

Existing categories:
 ${categoriesList}

Document analysis:
 ${analysisText.slice(0, 2000)}

Answer in JSON format only:
{
  "category": "suggested category name",
  "isNew": true or false (whether this is a new or existing category),
  "confidence": "high" or "medium" or "low"
}

Rules:
- If the document fits an existing category, use its exact name and set isNew = false
- If the document needs a new category, suggest a short clear name and set isNew = true`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // استخراج JSON من الرد
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return { suggestedName: null, confidence: "low" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      suggestedName: parsed.category || null,
      confidence: parsed.confidence || "low",
    };
  } catch (error) {
    console.error("[Category Suggest] Error:", error);
    return { suggestedName: null, confidence: "low" };
  }
}