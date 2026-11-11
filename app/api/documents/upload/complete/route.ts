import { NextResponse } from "next/server";

import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import {
  prepareIdentity,
  responseWithGuestCookie,
  type RequestIdentity,
} from "@/lib/documents/shared";
import {
  analyzeAndRegisterDocument,
  respondWithProcessResult,
  writeTempFile,
} from "@/lib/documents/process";
import { STORAGE_BUCKET } from "@/lib/documents/upload-config";
import {
  verifyUploadSessionToken,
  sessionMatchesIdentity,
  type UploadSessionPayload,
} from "@/lib/documents/upload-session";

export const runtime = "nodejs";

/* =========================================================
   الخطوة 3 من الرفع المباشر: إتمام التسجيل والتحليل
=========================================================
   POST /api/documents/upload/complete
   Body (JSON): { sessionToken }

   بعد أن يرفع المتصفح الملف مباشرة إلى Supabase Storage
   (بدون المرور على Vercel — بذلك نتجنب حد 4.5MB الذي يسبب 413):

   - التحقق من توكين الجلسة (HMAC) ومطابقة الهوية
   - تنزيل الملف من التخزين إلى /tmp على الخادم
   - باقي الخطوات كما هي بالضبط في خط المعالجة الموحد:
     hash → منع التكرار → حدود الباقة → نقل للمسار النهائي
     → استخراج النص → قاعدة البيانات → تسجيل الاستخدام
     → تحليل Gemini → صور المستند → الاقتراحات

   ملاحظة حدود حجم الملف:
   - لا يوجد أي حد حجم من كود التطبيق نفسه.
   - الحد الفعلي الوحيد: حد حجم الملف في إعدادات Supabase
     (Free: حتى 50MB — Pro: قابل للرفع حتى 500GB).
   - عمليات المعالجة نفسها (ffmpeg / تحليل Gemini) لها حدود
     ذاكرة Function واقعية، لذا الملفات متعددة الجيجابايت
     قد تُرفع بنجاح لكن معالجتها تتطلب موردًا أكبر.
========================================================= */

export async function POST(request: Request) {
  let identity: RequestIdentity | null = null;
  let isNewGuest = false;
  let session: UploadSessionPayload | null = null;

  try {
    /* =====================================================
       Body
    ===================================================== */
    let body: { sessionToken?: string };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "طلب غير صالح" },
        { status: 400 }
      );
    }

    /* =====================================================
       التحقق من توكين الجلسة
    ===================================================== */
    session = verifyUploadSessionToken(body.sessionToken || "");

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: "جلسة الرفع غير صالحة أو انتهت صلاحيتها — أعد المحاولة من البداية",
          sessionExpired: true,
        },
        { status: 401 }
      );
    }

    if (session.bucket !== STORAGE_BUCKET) {
      return NextResponse.json(
        { success: false, error: "باكت التخزين في الجلسة غير متطابق" },
        { status: 400 }
      );
    }

    /* =====================================================
       Identity — يجب أن تطابق هوية الجلسة
    ===================================================== */
    const prepared = await prepareIdentity(request);
    identity = prepared.identity;
    isNewGuest = prepared.isNewGuest;

    if (!sessionMatchesIdentity(session, identity)) {
      return NextResponse.json(
        {
          success: false,
          error: "هوية الطلب لا تطابق هوية جلسة الرفع — أعد رفع الملف من البداية",
        },
        { status: 403 }
      );
    }

    console.log(
      `[UploadComplete] Identity: ${
        identity.userId ? `user:${identity.userId}` : `guest:${identity.guestId}`
      } — ${session.fileName}`
    );

    /* =====================================================
       تنزيل الملف من Supabase Storage (بمفتاح الخدمة)
    ===================================================== */
    console.log(`[UploadComplete] تنزيل الملف من التخزين: ${session.storagePath}`);

    const download = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(session.storagePath);

    if (download.error || !download.data) {
      console.error("[UploadComplete] Download error:", download.error);

      return responseWithGuestCookie(
        {
          success: false,
          error: "لم يتم العثور على الملف في التخزين — قد يكون الرفع لم يكتمل. حاول رفع الملف مرة أخرى.",
          fileMissing: true,
        },
        400,
        identity,
        isNewGuest
      );
    }

    const arrayBuffer = await download.data.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    /* =====================================================
       كتابة نسخة على /tmp للأدوات (ffmpeg / LibreOffice / PDF)
    ===================================================== */
    const safeFileName = session.fileName.replace(/[/\\]/g, "_");
    const tmpFilePath = await writeTempFile(fileBuffer, safeFileName);

    /* =====================================================
       خط المعالجة الموحد — نفس المنطق المتبع في المسار القديم
    ===================================================== */
    const outcome = await analyzeAndRegisterDocument({
      identity,
      lang: session.lang,
      categoryId: session.categoryId,
      originalFileName: session.fileName,
      contentType: session.contentType,
      fileBuffer,
      tmpFilePath,
      storageMode: "finalize",
      pendingPath: session.storagePath,
    });

    return respondWithProcessResult(outcome, identity, isNewGuest);
  } catch (error) {
    console.error("[UploadComplete] Error:", error);
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف";

    return responseWithGuestCookie(
      {
        success: false,
        error: "حدث خطأ أثناء إتمام معالجة الملف، يرجى المحاولة مرة أخرى.",
        details: message,
      },
      500,
      identity || { user: null, userId: null, guestId: null },
      isNewGuest
    );
  }
}
