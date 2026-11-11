import { prepareIdentity, responseWithGuestCookie, type RequestIdentity } from "@/lib/documents/shared";
import {
  analyzeAndRegisterDocument,
  respondWithProcessResult,
  writeTempFile,
} from "@/lib/documents/process";
import path from "path";

export const runtime = "nodejs";

/* =========================================================
   المسار القديم للرفع عبر FormData (يظل يعمل كاحتياطي)
=========================================================
   بعد التحديث أصبح الرفع الافتراضي من الواجهة يتم عبر:
   init → رفع مباشر من المتصفح إلى Supabase → complete
   وهذا المسار محفوظ للتوافق الرجعي، وكذلك كخطة بديلة
   لو فشل الرفع المباشر لأي سبب.
========================================================= */

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

    console.log(
      "[Documents] Identity:",
      identity.userId ? `user:${identity.userId}` : `guest:${identity.guestId}`
    );

    /* =====================================================
       Read FormData
    ===================================================== */
    const formData = await request.formData();
    const file = formData.get("file");
    const lang = formData.get("lang") === "en" ? "en" : "ar";
    const categoryId = (formData.get("categoryId") as string | null) || null;

    if (!(file instanceof File)) {
      return responseWithGuestCookie(
        { success: false, error: "لم يتم إرسال ملف" },
        400,
        identity,
        isNewGuest
      );
    }

    const originalFileName = file.name;
    const safeFileName = path.basename(originalFileName);

    /* =====================================================
       Read File & Write Temp
    ===================================================== */
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const tmpFilePath = await writeTempFile(buffer, safeFileName);

    /* =====================================================
       خط المعالجة الموحد (hash → dedup → باقة → تخزين → تحليل)
    ===================================================== */
    const outcome = await analyzeAndRegisterDocument({
      identity,
      lang,
      categoryId,
      originalFileName,
      contentType: file.type || null,
      fileBuffer: buffer,
      tmpFilePath,
      storageMode: "legacy",
    });

    return respondWithProcessResult(outcome, identity, isNewGuest);
  } catch (error) {
    console.error("[Documents] Upload route error:", error);
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف";

    return responseWithGuestCookie(
      {
        success: false,
        error: "حدث خطأ أثناء معالجة الملف، يرجى المحاولة مرة أخرى.",
        details: message,
      },
      500,
      identity || { user: null, userId: null, guestId: null },
      isNewGuest
    );
  }
}
