import { generateJSON } from "@/lib/ai/gemini";

/* =========================================================
   اقتراح تصنيف ذكي بناءً على محتوى الملف
   (مركزي على عميل Gemini الموحد + تدوير المفاتيح)
========================================================= */

export async function suggestCategory(
  analysisText: string,
  existingCategories: string[],
  lang: "ar" | "en" = "ar"
): Promise<{ suggestedName: string | null; confidence: "high" | "medium" | "low" }> {
  try {
    const categoriesList =
      existingCategories.length > 0
        ? existingCategories.map((c, i) => `${i + 1}. ${c}`).join("\n")
        : "(لا توجد تصنيفات حالية)";

    const prompt =
      lang === "ar"
        ? `بناءً على التحليل التالي لمستند، اقترح التصنيف الأنسب له.

التصنيفات الموجودة:
${categoriesList}

تحليل المستند:
${analysisText.slice(0, 2000)}

قواعد:
- إذا كان المستند يناسب تصنيفًا موجودًا، استخدم اسمه بالضبط واجعل isNew = false
- إذا كان المستند يحتاج تصنيفًا جديدًا، اقترح اسم قصير وواضح واجعل isNew = true
- الاسم يجب أن يكون بالعربية`
        : `Based on the following document analysis, suggest the most appropriate category.

Existing categories:
${categoriesList}

Document analysis:
${analysisText.slice(0, 2000)}

Rules:
- If the document fits an existing category, use its exact name and set isNew = false
- If the document needs a new category, suggest a short clear name and set isNew = true`;

    const parsed = await generateJSON<{
      category?: string;
      isNew?: boolean;
      confidence?: string;
    }>(
      prompt,
      {
        type: "object",
        properties: {
          category: { type: "string" },
          isNew: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["category", "isNew", "confidence"],
      },
      { temperature: 0.2, maxOutputTokens: 512 }
    );

    const confidence = ["high", "medium", "low"].includes(
      parsed.confidence || ""
    )
      ? (parsed.confidence as "high" | "medium" | "low")
      : "low";

    return {
      suggestedName: parsed.category?.trim() || null,
      confidence,
    };
  } catch (error) {
    console.error("[Category Suggest] Error:", error);
    return { suggestedName: null, confidence: "low" };
  }
}
