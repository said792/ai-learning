import { mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

import { suggestCategory } from "@/lib/ai/category-suggest";
import { analyzeDocument } from "@/lib/ai/analyzer";
import {
  extractTextFromAnyFile,
  isVideoExt,
  isAudioExt,
  isImageExt,
} from "@/lib/files/universal";
import { isSupportedExtension } from "@/lib/files/registry";
import {
  processDocumentAssets,
  getSignedAssetUrls,
} from "@/lib/files/document-images";

import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import {
  checkUsagePermission,
  containsArabic,
  recordUsage,
  responseWithGuestCookie,
  type RequestIdentity,
} from "@/lib/documents/shared";
import { STORAGE_BUCKET } from "@/lib/documents/upload-config";
import type { NextResponse } from "next/server";

/* =========================================================
   خط معالجة وتحليل المستندات — منطق واحد مشترك
=========================================================
   يستخدمه المسار القديم (رفع عبر FormData) والمسار الجديد
   (complete بعد الرفع المباشر) — نفس الخطوات بالترتيب نفسه:
   hash → منع التكرار → حدود الباقة → التخزين → استخراج النص
   → قاعدة البيانات → تسجيل الاستخدام → تحليل Gemini → الصور
========================================================= */

/* =========================================================
   أنواع النتائج
========================================================= */

export type ProcessOutcome =
  | { kind: "error"; status: number; payload: Record<string, unknown> }
  | { kind: "existing"; status: number; payload: Record<string, unknown> }
  | { kind: "success"; status: number; payload: Record<string, unknown> };

export type ProcessInput = {
  identity: RequestIdentity;
  lang: "ar" | "en";
  categoryId: string | null;
  originalFileName: string;
  contentType: string | null;
  fileBuffer: Buffer;
  tmpFilePath: string;
  /**
   * legacy: ارفع الـ buffer إلى المسار النهائي (المسار القديم عبر FormData)
   * finalize: انقل الكائن من مسار الرفع المؤقت إلى المسار النهائي
   *           (المسار الجديد — الرفع تم مباشرة إلى Supabase)
   */
  storageMode: "legacy" | "finalize";
  pendingPath?: string | null;
};

/* =========================================================
   المسار النهائي في التخزين (نفس نمط المسار القديم: hash/uuid.ext)
========================================================= */

function buildFinalStoragePath(fileHash: string, extension: string): string {
  const storageFileName = `${crypto.randomUUID()}${extension}`;
  return `${fileHash}/${storageFileName}`;
}

/* =========================================================
   الخطوة: حفظ الكائن في مساره النهائي
========================================================= */

async function persistToFinalPath(input: ProcessInput, finalPath: string, contentType: string): Promise<void> {
  if (input.storageMode === "legacy") {
    console.log(`[Documents] رفع الملف إلى Supabase Storage: ${finalPath}`);

    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(finalPath, input.fileBuffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (storageError && !storageError.message.toLowerCase().includes("already exists")) {
      throw new Error(`فشل رفع الملف إلى Supabase Storage: ${storageError.message}`);
    }

    return;
  }

  /* ---------- وضع finalize: نقل من pending إلى المسار النهائي ---------- */
  const pendingPath = input.pendingPath;
  if (!pendingPath) {
    throw new Error("وضع finalize يتطلب مسار الملف المؤقت pendingPath");
  }

  console.log(`[Documents] نقل الكائن من ${pendingPath} إلى ${finalPath}`);

  const { error: moveError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .move(pendingPath, finalPath);

  if (!moveError) return;

  /* خطة بديلة: لو النقل فشل لأي سبب نرفع الـ buffer نفسه مرة أخرى */
  console.warn(`[Documents] فشل النقل (${moveError.message}) — جاري رفع الملف من الذاكرة كبديل`);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(finalPath, input.fileBuffer, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
    throw new Error(`فشل حفظ الملف في التخزين: ${uploadError.message}`);
  }
}

/* =========================================================
   الخطوة: حذف الكائن المؤقت (لو أرجعنا نتيجة ملف موجود مسبقًا)
========================================================= */

async function removePendingObject(pendingPath?: string | null): Promise<void> {
  if (!pendingPath) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([pendingPath]);
  } catch (removeError) {
    console.warn("[Documents] تعذر حذف الكائن المؤقت (غير حرج):", removeError);
  }
}

/* =========================================================
   الدالة الرئيسية
========================================================= */

export async function analyzeAndRegisterDocument(input: ProcessInput): Promise<ProcessOutcome> {
  let documentId: string | null = null;
  const { identity, lang } = input;
  const originalFileName = input.originalFileName;
  const lowerFileName = originalFileName.toLowerCase();
  const extension = path.extname(lowerFileName);

  try {
    /* =====================================================
       التحقق من امتداد الملف
    ===================================================== */
    if (!extension || !isSupportedExtension(extension)) {
      return {
        kind: "error",
        status: 400,
        payload: {
          success: false,
          error: "نوع الملف غير مدعوم حاليًا — تحقق من قائمة الصيغ المدعومة في القائمة الجانبية",
          fileName: originalFileName,
          fileType: input.contentType,
        },
      };
    }

    /* =====================================================
       Hash
    ===================================================== */
    const fileHash = crypto.createHash("sha256").update(input.fileBuffer).digest("hex");
    const finalStoragePath = buildFinalStoragePath(fileHash, extension);

    /* =====================================================
       منع تكرار الملفات (حسب الهاش + هوية المالك)
    ===================================================== */
    let existingQuery = supabase
      .from("documents")
      .select(`
        id, file_name, file_hash, file_path, file_type, media_type, file_size,
        extracted_text, analysis, status, error_message, user_id, guest_id, created_at, updated_at
      `)
      .eq("file_hash", fileHash);

    if (identity.userId) {
      existingQuery = existingQuery.eq("user_id", identity.userId);
    } else if (identity.guestId) {
      existingQuery = existingQuery.eq("guest_id", identity.guestId).is("user_id", null);
    } else {
      existingQuery = existingQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }

    const { data: existingDocument, error: existingDocumentError } = await existingQuery.maybeSingle();

    if (existingDocumentError) {
      console.error("[Documents] Existing document lookup error:", existingDocumentError);
      throw new Error("تعذر البحث عن الملف في قاعدة البيانات");
    }

    /* =====================================================
       Existing Completed — نفس المحتوى سبق تحليله
    ===================================================== */
    if (existingDocument && existingDocument.status === "completed") {
      const analysisSummary = existingDocument.analysis?.summary || "";
      const isSavedInArabic = containsArabic(analysisSummary);

      if (lang === "en" && isSavedInArabic) {
        console.log(`[Documents] إعادة تحليل الملف باللغة الإنجليزية: ${originalFileName}`);
        const newAnalysis = await analyzeDocument(existingDocument.extracted_text || "", "en");

        const { error: updateError } = await supabase
          .from("documents")
          .update({ analysis: newAnalysis, updated_at: new Date().toISOString() })
          .eq("id", existingDocument.id);

        if (updateError) throw new Error(`فشل حفظ التحليل الجديد: ${updateError.message}`);

        await removePendingObject(input.pendingPath);

        return {
          kind: "existing",
          status: 200,
          payload: {
            success: true,
            existing: true,
            documentId: existingDocument.id,
            fileName: existingDocument.file_name,
            mediaType: existingDocument.media_type,
            textLength: existingDocument.extracted_text?.length ?? 0,
            text: existingDocument.extracted_text?.substring(0, 1000) ?? "",
            analysis: newAnalysis,
            usageCharged: false,
            message: "لديك هذا الملف بالفعل، ولكن تم تحليله بالعربية. تم إعادة تحليله بالإنجليزية بنجاح.",
          },
        };
      }

      if (lang === "ar" && !isSavedInArabic && analysisSummary.length > 20) {
        console.log(`[Documents] إعادة تحليل الملف باللغة العربية: ${originalFileName}`);
        const newAnalysis = await analyzeDocument(existingDocument.extracted_text || "", "ar");

        const { error: updateError } = await supabase
          .from("documents")
          .update({ analysis: newAnalysis, updated_at: new Date().toISOString() })
          .eq("id", existingDocument.id);

        if (updateError) throw new Error(`فشل حفظ التحليل الجديد: ${updateError.message}`);

        await removePendingObject(input.pendingPath);

        return {
          kind: "existing",
          status: 200,
          payload: {
            success: true,
            existing: true,
            documentId: existingDocument.id,
            fileName: existingDocument.file_name,
            mediaType: existingDocument.media_type,
            textLength: existingDocument.extracted_text?.length ?? 0,
            text: existingDocument.extracted_text?.substring(0, 1000) ?? "",
            analysis: newAnalysis,
            usageCharged: false,
            message: "لديك هذا الملف بالفعل، ولكن تم تحليله بالإنجليزية. تم إعادة تحليله بالعربية بنجاح.",
          },
        };
      }

      console.log(`[Documents] الملف موجود بالفعل لنفس المستخدم بنفس اللغة: ${originalFileName}`);
      await removePendingObject(input.pendingPath);

      return {
        kind: "existing",
        status: 200,
        payload: {
          success: true,
          existing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          mediaType: existingDocument.media_type,
          textLength: existingDocument.extracted_text?.length ?? 0,
          text: existingDocument.extracted_text?.substring(0, 1000) ?? "",
          analysis: existingDocument.analysis,
          usageCharged: false,
          message: "لديك بالفعل ملف بنفس المحتوى تم تحليله مسبقًا. تم استرجاع التحليل المحفوظ.",
        },
      };
    }

    /* =====================================================
       Existing Processing
    ===================================================== */
    if (existingDocument && existingDocument.status === "processing") {
      await removePendingObject(input.pendingPath);

      return {
        kind: "existing",
        status: 200,
        payload: {
          success: true,
          existing: true,
          processing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          message: "الملف موجود بالفعل وما زال قيد المعالجة، يرجى الانتظار قليلاً.",
        },
      };
    }

    /* =====================================================
       Existing Uploaded
    ===================================================== */
    if (existingDocument && existingDocument.status === "uploaded") {
      await removePendingObject(input.pendingPath);

      return {
        kind: "existing",
        status: 200,
        payload: {
          success: true,
          existing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          mediaType: existingDocument.media_type,
          usageCharged: false,
          message: "الملف موجود بالفعل وتم رفعه مسبقًا.",
        },
      };
    }

    /* =====================================================
       Failed Document — نحذف السجل ونحاول من جديد
    ===================================================== */
    if (existingDocument && existingDocument.status === "failed") {
      console.log(`[Documents] حذف السجل الفاشل وإعادة المحاولة: ${fileHash}`);
      const { error: deleteError } = await supabase
        .from("documents")
        .delete()
        .eq("id", existingDocument.id);

      if (deleteError) throw new Error("تعذر حذف السجل السابق للملف");
    }

    /* =====================================================
       حدود الباقة اليومية والشهرية
    ===================================================== */
    const usage = await checkUsagePermission(identity);

    console.log("[Usage]", {
      userType: usage.userType,
      usedToday: usage.usedToday,
      dailyLimit: usage.dailyLimit,
      usedThisMonth: usage.usedThisMonth,
      monthlyLimit: usage.monthlyLimit,
      allowed: usage.allowed,
    });

    if (!usage.allowed) {
      await removePendingObject(input.pendingPath);

      return {
        kind: "error",
        status: 403,
        payload: {
          success: false,
          limitReached: true,
          subscriptionExpired: Boolean(identity.userId && !usage.subscription),
          userType: usage.userType,
          usedToday: usage.usedToday,
          dailyLimit: usage.dailyLimit,
          usedThisMonth: usage.usedThisMonth ?? null,
          monthlyLimit: usage.monthlyLimit ?? null,
          plan: usage.subscription?.plan?.name ?? null,
          error: usage.reason || "تم الوصول إلى حد الاستخدام.",
        },
      };
    }

    /* =====================================================
       التخزين: رفع أو نقل الكائن إلى مساره النهائي
    ===================================================== */
    const contentType = input.contentType || "application/octet-stream";
    await persistToFinalPath(input, finalStoragePath, contentType);

    /* =====================================================
       Media Type Detection (موحد عبر registry)
    ===================================================== */
    const isVideo = isVideoExt(extension);
    const isAudio = isAudioExt(extension);
    const isImage = isImageExt(extension);
    const isMedia = isVideo || isAudio;
    const mediaType = isMedia ? "media" : "document";

    /* =====================================================
       استخراج النص عبر المُوجّه الموحد (كل الصيغ)
    ===================================================== */
    let text = "";
    let emptyReason: string | undefined;

    {
      const result = await extractTextFromAnyFile({
        filePath: input.tmpFilePath,
        originalName: originalFileName,
        extension,
        fileBuffer: input.fileBuffer,
        fileMime: input.contentType || undefined,
        lang,
        isVideo,
        isAudio,
        isImage,
      });

      text = result.text;
      emptyReason = result.emptyReason;
    }

    if (!text.trim()) {
      return {
        kind: "error",
        status: 422,
        payload: {
          success: false,
          error:
            emptyReason ||
            "لم يتم استخراج أي نص من الملف حتى بعد محاولة قراءته بالذكاء الاصطناعي. تأكد من أن الملف يحتوي على نص واضح قابل للقراءة.",
          fileName: originalFileName,
        },
      };
    }

    /* =====================================================
       حفظ المستند في قاعدة البيانات
    ===================================================== */
    const { data: insertedDocument, error: insertDocumentError } = await supabase
      .from("documents")
      .insert({
        file_name: originalFileName,
        file_hash: fileHash,
        file_path: finalStoragePath,
        file_type: input.contentType || extension,
        media_type: mediaType,
        file_size: input.fileBuffer.length,
        extracted_text: text,
        analysis: null,
        status: "processing",
        error_message: null,
        user_id: identity.userId,
        guest_id: identity.guestId,
        category_id: input.categoryId,
      })
      .select()
      .single();

    if (insertDocumentError) {
      throw new Error(`فشل حفظ المستند في قاعدة البيانات: ${insertDocumentError.message}`);
    }

    documentId = insertedDocument.id;

    /* =====================================================
       تسجيل الاستخدام
    ===================================================== */
    await recordUsage(identity);
    console.log(`[Usage] تم تسجيل محاولة التحليل للمستخدم: ${identity.userId || identity.guestId}`);

    /* =====================================================
       تحليل Gemini
    ===================================================== */
    console.log(`[Documents] بدء تحليل Gemini باللغة: ${lang}...`);
    const analysis = await analyzeDocument(text, lang);

    /* =====================================================
       حفظ التحليل
    ===================================================== */
    const { error: updateDocumentError } = await supabase
      .from("documents")
      .update({
        analysis,
        status: "completed",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (updateDocumentError) {
      throw new Error(`تم التحليل ولكن فشل حفظ التحليل: ${updateDocumentError.message}`);
    }

    console.log(`[Documents] تم حفظ التحليل بنجاح: ${documentId}`);

    /* =====================================================
       اقتراح تصنيف
    ===================================================== */
    let categorySuggestion: { suggestedName: string | null; confidence: string } = {
      suggestedName: null,
      confidence: "low",
    };

    if (!input.categoryId && text.trim()) {
      try {
        let catNameQuery = supabase
          .from("categories")
          .select("name");

        if (identity.userId) {
          catNameQuery = catNameQuery.eq("user_id", identity.userId);
        } else if (identity.guestId) {
          catNameQuery = catNameQuery.eq("guest_id", identity.guestId).is("user_id", null);
        }

        const { data: existingCats } = await catNameQuery;
        const catNames = (existingCats || []).map((c: { name: string }) => c.name);

        const analysisSummary = analysis?.summary || analysis?.title || "";
        const suggestionInput = `${analysisSummary}\n\n${text.substring(0, 1000)}`;

        categorySuggestion = await suggestCategory(suggestionInput, catNames, lang);
      } catch (e) {
        console.error("[Documents] Category suggestion error:", e);
      }
    }

    /* =====================================================
       صور المستند: استخراج + تحليل + رفع (غير حرج)
    ===================================================== */
    let assets: Array<{
      id: string;
      url: string | null;
      pageNumber: number | null;
      source: string;
      analysis: {
        description: string;
        textInImage?: string;
        educationalNote?: string;
      } | null;
    }> = [];

    try {
      const storedAssets = await processDocumentAssets({
        documentId: documentId as string,
        filePath: input.tmpFilePath,
        extension,
        documentTitle: analysis?.title || originalFileName,
        userId: identity.userId ?? null,
        guestId: identity.guestId ?? null,
        lang,
      });

      if (storedAssets.length > 0) {
        const signedUrls = await getSignedAssetUrls(
          storedAssets.map((a) => a.storage_path)
        );

        assets = storedAssets.map((a) => ({
          id: a.id,
          url: signedUrls[a.storage_path] || null,
          pageNumber: a.page_number,
          source: a.source,
          analysis: a.analysis,
        }));
      }
    } catch (assetsError) {
      console.error("[Documents] خطأ في خط الصور (غير حرج):", assetsError);
    }

    /* =====================================================
       Final Usage
    ===================================================== */
    const finalUsage = await checkUsagePermission(identity);

    /* =====================================================
       Success
    ===================================================== */
    return {
      kind: "success",
      status: 200,
      payload: {
        success: true,
        existing: false,
        documentId,
        fileName: originalFileName,
        mediaType,
        textLength: text.length,
        text: text.substring(0, 1000),
        analysis,
        categorySuggestion,
        assets,
        usage: {
          userType: finalUsage.userType,
          usedToday: finalUsage.usedToday,
          dailyLimit: finalUsage.dailyLimit,
          usedThisMonth: finalUsage.usedThisMonth ?? null,
          monthlyLimit: finalUsage.monthlyLimit ?? null,
          plan: finalUsage.subscription?.plan?.name ?? null,
        },
        usageCharged: true,
        message: isMedia
          ? "تم رفع الملف الصوتي/الفيديو واستخراج النص وتحليله بنجاح."
          : isImage
          ? "تم رفع الصورة واستخراج النص بالذكاء الاصطناعي وتحليله بنجاح."
          : "تم رفع الملف وتحليله وحفظه بنجاح.",
      },
    };
  } catch (error) {
    console.error("[Documents] File processing error:", error);

    /* =====================================================
       تحديث حالة المستند إلى failed
    ===================================================== */
    if (documentId) {
      try {
        await supabase
          .from("documents")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "حدث خطأ غير معروف",
            updated_at: new Date().toISOString(),
          })
          .eq("id", documentId);
      } catch (databaseError) {
        console.error("[Documents] Failed to update document status:", databaseError);
      }
    }

    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف";
    const lowerMessage = message.toLowerCase();

    const isGeminiQuota =
      lowerMessage.includes("quota") ||
      lowerMessage.includes("429") ||
      lowerMessage.includes("rate limit") ||
      lowerMessage.includes("resource exhausted");

    return {
      kind: "error",
      status: 500,
      payload: {
        success: false,
        error: isGeminiQuota
          ? "خدمة الذكاء الاصطناعي وصلت إلى الحد المتاح حاليًا. حاول مرة أخرى لاحقًا."
          : "حدث خطأ أثناء معالجة الملف، يرجى المحاولة مرة أخرى.",
        details: message,
        geminiQuota: isGeminiQuota,
        documentId: documentId,
      },
    };
  }
}

/* =========================================================
   كتابة الملف على القرص المؤقت (/tmp) — مشترك بين المسارين
========================================================= */

export async function writeTempFile(
  buffer: Buffer,
  safeFileName: string
): Promise<string> {
  // Vercel: استخدم مجلد /tmp القابل للكتابة بدل مجلد المشروع
  const uploadDir = path.join(os.tmpdir(), "ai-learning-uploads");
  await mkdir(uploadDir, { recursive: true });

  const localFileName = `${crypto.randomUUID()}-${safeFileName}`;
  const filePath = path.join(uploadDir, localFileName);

  await writeFile(filePath, buffer);
  return filePath;
}

/* =========================================================
   غلاف موحد: ينفذ المعالجة ويحوّل النتيجة إلى NextResponse
========================================================= */

export async function respondWithProcessResult(
  outcome: ProcessOutcome,
  identity: RequestIdentity,
  isNewGuest: boolean
): Promise<NextResponse> {
  return responseWithGuestCookie(outcome.payload, outcome.status, identity, isNewGuest);
}
