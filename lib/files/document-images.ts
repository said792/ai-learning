import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateJSON } from "@/lib/ai/gemini";
import { renderPdfPages } from "@/lib/files/pdf-images";
import { extractOfficeImages } from "@/lib/files/office-images";
import { IMAGE_MIME_MAP } from "@/lib/files/registry";

/* =========================================================
   خط الصور الكامل:
   استخراج الصور من المستند → تحليل كل صورة بـ Gemini Vision
   → رفعها إلى Supabase Storage → حفظ السجلات في document_assets
========================================================= */

const STORAGE_BUCKET = "documents";

const MAX_ANALYZED_IMAGES = Number(process.env.DOC_IMAGES_MAX_ANALYZED ?? 12);
const MAX_PDF_PAGES = Number(process.env.DOC_IMAGES_MAX_PAGES ?? 20);
const MAX_OFFICE_IMAGES = 30;

export type PendingAsset = {
  buffer: Buffer;
  mimeType: string;
  pageNumber: number | null;
  source: "page_render" | "embedded" | "original";
};

export type StoredAsset = {
  id: string;
  storage_path: string;
  mime_type: string;
  page_number: number | null;
  source: string;
  analysis: ImageAnalysis | null;
  sort_order: number;
};

export interface ImageAnalysis {
  description: string;
  textInImage?: string;
  educationalNote?: string;
}

/* =========================================================
   1) الاستخراج حسب نوع الملف
========================================================= */

export async function extractDocumentAssets(
  filePath: string,
  extension: string
): Promise<PendingAsset[]> {
  const ext = extension.toLowerCase();

  try {
    if (ext === ".pdf") {
      const pages = await renderPdfPages(filePath, { maxPages: MAX_PDF_PAGES });
      return pages.map((p) => ({
        buffer: p.buffer,
        mimeType: "image/png",
        pageNumber: p.pageNumber,
        source: "page_render" as const,
      }));
    }

    if (ext === ".docx" || ext === ".pptx") {
      const images = await extractOfficeImages(filePath, {
        maxImages: MAX_OFFICE_IMAGES,
      });
      return images.map((img) => ({
        buffer: img.buffer,
        mimeType: img.mimeType,
        pageNumber: null,
        source: "embedded" as const,
      }));
    }

    if (IMAGE_MIME_MAP[ext]) {
      const { readFile } = await import("fs/promises");
      const buffer = await readFile(filePath);
      return [
        {
          buffer,
          mimeType: IMAGE_MIME_MAP[ext] || "image/jpeg",
          pageNumber: null,
          source: "original",
        },
      ];
    }
  } catch (error) {
    console.error("[Assets] استخراج الصور فشل (غير حرج):", error);
  }

  return [];
}

/* =========================================================
   2) تحليل صورة واحدة
========================================================= */

export async function analyzeImageContent(
  image: { buffer: Buffer; mimeType: string },
  documentTitle: string,
  lang: "ar" | "en" = "ar"
): Promise<ImageAnalysis | null> {
  try {
    const prompt =
      lang === "ar"
        ? `هذه صورة من مستند تعليمي بعنوان: "${documentTitle}".
حلل الصورة وأجب في الحقول التالية:
- description: وصف موجز (جملة إلى جملتين) لمحتوى الصورة
- textInImage: النص المكتوب داخل الصورة إن وجد (مختصر)
- educationalNote: ملاحظة تعليمية تشرح فائدة هذه الصورة في فهم الدرس (مثال: "الرسم يوضح خطوات الدورة الدموية")
أجب بالعربية فقط واعتمد فقط على ما تراه في الصورة.`
        : `This image is from an educational document titled: "${documentTitle}".
Analyze the image and fill:
- description: brief description (1-2 sentences)
- textInImage: text visible in the image (if any, shortened)
- educationalNote: a short educational note on how this image helps understanding
Answer in English and rely only on what you see.`;

    const parsed = await generateJSON<ImageAnalysis>(
      prompt,
      {
        type: "object",
        properties: {
          description: { type: "string" },
          textInImage: { type: "string" },
          educationalNote: { type: "string" },
        },
        required: ["description"],
      },
      { temperature: 0.2, maxOutputTokens: 600 }
    );

    return {
      description: parsed.description || "",
      textInImage: parsed.textInImage || undefined,
      educationalNote: parsed.educationalNote || undefined,
    };
  } catch (error) {
    console.error("[Assets] تحليل الصورة فشل (غير حرج):", error);
    return null;
  }
}

/* =========================================================
   3) المعالجة الكاملة
========================================================= */

export async function processDocumentAssets(options: {
  documentId: string;
  filePath: string;
  extension: string;
  documentTitle: string;
  userId: string | null;
  guestId: string | null;
  lang: "ar" | "en";
}): Promise<StoredAsset[]> {
  const {
    documentId,
    filePath,
    extension,
    documentTitle,
    userId,
    guestId,
    lang,
  } = options;

  const pending = await extractDocumentAssets(filePath, extension);

  if (pending.length === 0) {
    console.log("[Assets] لا توجد صور في هذا المستند");
    return [];
  }

  console.log(`[Assets] تم استخراج ${pending.length} صورة من المستند`);

  const stored: StoredAsset[] = [];

  for (let i = 0; i < pending.length; i++) {
    const asset = pending[i];
    const storagePath = `assets/${documentId}/${i + 1}.${asset.mimeType.includes("png") ? "png" : "jpg"}`;

    try {
      // الرفع إلى Storage
      const { error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, asset.buffer, {
          contentType: asset.mimeType,
          cacheControl: "31536000",
          upsert: false,
        });

      if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
        console.error("[Assets] فشل رفع الصورة:", uploadError.message);
        continue;
      }

      // التحليل (بحد أقصى)
      const analysis =
        i < MAX_ANALYZED_IMAGES
          ? await analyzeImageContent(
              { buffer: asset.buffer, mimeType: asset.mimeType },
              documentTitle,
              lang
            )
          : null;

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("document_assets")
        .insert({
          document_id: documentId,
          user_id: userId,
          guest_id: guestId,
          storage_path: storagePath,
          mime_type: asset.mimeType,
          page_number: asset.pageNumber,
          source: asset.source,
          analysis,
          sort_order: i,
        })
        .select("id, storage_path, mime_type, page_number, source, analysis, sort_order")
        .single();

      if (insertError) {
        console.error("[Assets] فشل حفظ سجل الصورة:", insertError.message);
        continue;
      }

      stored.push(inserted as StoredAsset);
    } catch (error) {
      console.error("[Assets] خطأ في معالجة صورة (تم التخطي):", error);
    }
  }

  console.log(`[Assets] تم حفظ ${stored.length} صورة للمستند ${documentId}`);

  return stored;
}

/* =========================================================
   4) روابط موقعة للعرض
========================================================= */

export async function getSignedAssetUrls(
  storagePaths: string[]
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};

  const urls: Record<string, string> = {};

  // على دفعات (حد Supabase معقول)
  const BATCH = 50;

  for (let i = 0; i < storagePaths.length; i += BATCH) {
    const batch = storagePaths.slice(i, i + BATCH);

    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrls(batch, 60 * 60); // صالحة ساعة

    if (error) {
      console.error("[Assets] فشل توليد روابط الصور:", error.message);
      continue;
    }

    for (const item of data || []) {
      if (item.path && item.signedURL) {
        urls[item.path] = item.signedURL;
      }
    }
  }

  return urls;
}
