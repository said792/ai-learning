import crypto from "crypto";

import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import {
  prepareIdentity,
  responseWithGuestCookie,
  checkUsagePermission,
  type RequestIdentity,
} from "@/lib/documents/shared";
import {
  STORAGE_BUCKET,
  PENDING_PATH_PREFIX,
  DIRECT_UPLOAD_MAX_MB,
  PENDING_CLEANUP_PROBABILITY,
  PENDING_CLEANUP_MAX_AGE_MS,
} from "@/lib/documents/upload-config";
import { createUploadSessionToken } from "@/lib/documents/upload-session";
import { isSupportedExtension } from "@/lib/files/registry";

export const runtime = "nodejs";

/* =========================================================
   الخطوة 1 من الرفع المباشر: تهيئة جلسة الرفع
=========================================================
   POST /api/documents/upload/init
   Body (JSON): { fileName, fileSize, contentType, lang, categoryId }

   الوظيفة:
   - التحقق من الهوية (مستخدم أو زائر)
   - التحقق من امتداد الملف المدعوم
   - فحص حدود الباقة (يومي/شهري/زائر) قبل بدء الرفع
   - إنشاء Signed Upload URL من Supabase (بدون الكشف عن أي مفتاح)
   - إصدار توكين جلسة HMAC مرتبط بالهوية والمسار
   - اختيار طريقة الرفع: مباشر للملفات الصغيرة أو TUS للكبيرة

   لا يمر هنا أي محتوى ملف — طلب JSON خفيف جدًا يتجاوز
   مشكلة HTTP 413 في Vercel تمامًا.
========================================================= */

/* =========================================================
   تنظيف الملفات المؤقتة المهملة (غير حرج)
========================================================= */

async function cleanupAbandonedPendingFiles(): Promise<void> {
  if (Math.random() > PENDING_CLEANUP_PROBABILITY) return;

  try {
    const cutoff = Date.now() - PENDING_CLEANUP_MAX_AGE_MS;
    const prefix = `${PENDING_PATH_PREFIX}/`;
    let offset = 0;
    const toDelete: string[] = [];

    /* حتى 10 صفحات (1000 ملف) لكل تشغيل — كافي ومحدود الحمل */
    for (let page = 0; page < 10; page++) {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(PENDING_PATH_PREFIX, { limit: 100, offset, sortBy: { column: "created_at", order: "asc" } });

      if (error || !data || data.length === 0) break;

      for (const object of data) {
        if (!object.name || object.id === null) continue; // مجلد فرعي
        const createdAt = object.created_at ? new Date(object.created_at).getTime() : 0;
        if (createdAt > 0 && createdAt < cutoff) {
          toDelete.push(`${prefix}${object.name}`);
        }
      }

      if (data.length < 100) break;
      offset += 100;
    }

    if (toDelete.length > 0) {
      /* الحذف على دفعات من 50 */
      for (let i = 0; i < toDelete.length; i += 50) {
        await supabase.storage.from(STORAGE_BUCKET).remove(toDelete.slice(i, i + 50));
      }
      console.log(`[UploadInit] حذف ${toDelete.length} ملف مؤقت مهمل`);
    }
  } catch (cleanupError) {
    console.warn("[UploadInit] تنظيف الملفات المؤقتة فشل (غير حرج):", cleanupError);
  }
}

/* =========================================================
   POST
========================================================= */

export async function POST(request: Request) {
  let identity: RequestIdentity | null = null;
  let isNewGuest = false;

  try {
    /* =====================================================
       Identity
    ===================================================== */
    const prepared = await prepareIdentity(request);
    identity = prepared.identity;
    isNewGuest = prepared.isNewGuest;

    /* =====================================================
       Body (JSON خفيف — لا يوجد محتوى ملف هنا)
    ===================================================== */
    let body: {
      fileName?: string;
      fileSize?: number;
      contentType?: string;
      lang?: string;
      categoryId?: string | null;
    };

    try {
      body = await request.json();
    } catch {
      return responseWithGuestCookie(
        { success: false, error: "طلب غير صالح" },
        400,
        identity,
        isNewGuest
      );
    }

    const fileName = (body.fileName || "").trim();
    const fileSize = Number(body.fileSize ?? 0);
    const contentType = (body.contentType || "").trim() || null;
    const lang = body.lang === "en" ? "en" : "ar";
    const categoryId = body.categoryId || null;

    if (!fileName) {
      return responseWithGuestCookie(
        { success: false, error: "لم يتم إرسال اسم الملف" },
        400,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       التحقق من الامتداد قبل أي رفع
    ===================================================== */
    const extension = (fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "");
    if (!extension || !isSupportedExtension(extension)) {
      return responseWithGuestCookie(
        {
          success: false,
          error: "نوع الملف غير مدعوم حاليًا — تحقق من قائمة الصيغ المدعومة في القائمة الجانبية",
          fileName,
          fileType: contentType,
        },
        400,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       فحص حدود الباقة قبل بدء الرفع (فحص مبدئي —
       الفحص النهائي وتسجيل الاستخدام يتم في complete)
    ===================================================== */
    const usage = await checkUsagePermission(identity);

    if (!usage.allowed) {
      return responseWithGuestCookie(
        {
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
        403,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       مسار التخزين المؤقت — مسار عشوائي فريد لا يمكن تخمينه
       (الملف ينتقل لمساره النهائي hash/uuid.ext في complete)
    ===================================================== */
    const pendingPath = `${PENDING_PATH_PREFIX}/${crypto.randomUUID()}${extension}`;

    /* =====================================================
       Signed Upload URL من Supabase (ساعتان)
       يعتمد على مفتاح الخدمة من الخادم فقط — لا يُكشف أي مفتاح
    ===================================================== */
    const signed = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(pendingPath);

    if (signed.error || !signed.data) {
      console.error("[UploadInit] createSignedUploadUrl error:", signed.error);
      throw new Error(
        `فشل إنشاء جلسة الرفع المباشر: ${signed.error?.message || "خطأ غير معروف"}`
      );
    }

    /* =====================================================
       اختيار طريقة الرفع:
       - direct: ملف صغير → POST واحد مباشر للـ signed URL
       - resumable: ملف كبير → TUS مقسّم قابل للاستكمال
       لا يوجد حد على حجم الملف — الأكبر فقط يستخدم TUS
    ===================================================== */
    const useResumable = fileSize > DIRECT_UPLOAD_MAX_MB * 1024 * 1024;

    /* =====================================================
       توكين جلسة الرفع (HMAC) — يربط الهوية بالمسار والمدة
    ===================================================== */
    const sessionToken = createUploadSessionToken({
      storagePath: pendingPath,
      fileName,
      fileSize: Number.isFinite(fileSize) && fileSize > 0 ? Math.floor(fileSize) : 0,
      contentType,
      lang,
      categoryId,
      userId: identity.userId,
      guestId: identity.guestId,
    });

    console.log(
      `[UploadInit] جلسة رفع (${useResumable ? "TUS" : "direct"}) — ${
        identity.userId ? `user:${identity.userId}` : `guest:${identity.guestId}`
      } — ${fileName} (${fileSize} bytes)`
    );

    /* تنظيف الملفات المؤقتة المهملة (احتمالي — غير حرج) */
    void cleanupAbandonedPendingFiles();

    /* =====================================================
       النتيجة
    ===================================================== */
    return responseWithGuestCookie(
      {
        success: true,
        mode: useResumable ? "resumable" : "direct",
        bucket: STORAGE_BUCKET,
        storagePath: pendingPath,
        /* للرفع المباشر: POST الملف إلى هذا الرابط */
        signedUrl: signed.data.signedUrl,
        /* لرفع TUS: التوكن في هيدر x-signature */
        signatureToken: signed.data.token,
        /* توكين الجلسة لإثبات ملكية الرفع عند complete */
        sessionToken,
        usage: {
          userType: usage.userType,
          usedToday: usage.usedToday,
          dailyLimit: usage.dailyLimit,
          usedThisMonth: usage.usedThisMonth ?? null,
          monthlyLimit: usage.monthlyLimit ?? null,
          plan: usage.subscription?.plan?.name ?? null,
        },
      },
      200,
      identity,
      isNewGuest
    );
  } catch (error) {
    console.error("[UploadInit] Error:", error);
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف";

    return responseWithGuestCookie(
      {
        success: false,
        error: "تعذر تهيئة جلسة الرفع المباشر، يرجى المحاولة مرة أخرى.",
        details: message,
      },
      500,
      identity || { user: null, userId: null, guestId: null },
      isNewGuest
    );
  }
}
