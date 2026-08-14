import { NextResponse } from "next/server";
import { mkdir, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

import { analyzeDocument } from "@/lib/ai/analyzer";
import { extractPdfText } from "@/lib/files/pdf";
import { extractWordText } from "@/lib/files/word";
import { extractPowerPointText } from "@/lib/files/powerpoint";
import { extractAudioFromVideo } from "@/lib/files/video";
import { transcribeAudioToText } from "@/lib/files/transcribe";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/* =========================================================
   Supabase
========================================================= */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/* =========================================================
   Configuration
========================================================= */

const STORAGE_BUCKET = "documents";
const GUEST_DAILY_LIMIT = 3;
const USAGE_ACTION = "document_analysis";

const AUTH_COOKIE_NAMES = [
  "ai_learning_session",
  "auth_token",
  "session_token",
  "access_token",
  "token",
];

const GUEST_COOKIE_NAME = "ai_guest_id";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/* =========================================================
   Types
========================================================= */

type AuthUser = {
  id: string;
  full_name?: string | null;
  username?: string | null;
  phone?: string | null;
  national_id?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
};

type SubscriptionInfo = {
  id: string;
  user_id: string;
  plan_id: string;
  start_date: string;
  end_date: string;
  status: string;
  plan: {
    id: string;
    name: string;
    monthly_limit: number | null;
    daily_limit: number | null;
    price: number | null;
    duration_days: number | null;
    is_active: boolean;
    features: Record<string, unknown> | null;
  };
};

type RequestIdentity = {
  user: AuthUser | null;
  userId: string | null;
  guestId: string | null;
};

/* =========================================================
   Arabic Detection
========================================================= */

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/* =========================================================
   Cookie Parser
========================================================= */

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (!cookieHeader) return result;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) continue;

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (!key) continue;

    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }

  return result;
}

/* =========================================================
   Guest ID
========================================================= */

function getOrCreateGuestId(
  request: Request
): { guestId: string; isNew: boolean } {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const existingGuestId = cookies[GUEST_COOKIE_NAME]?.trim();

  if (existingGuestId) {
    return {
      guestId: existingGuestId,
      isNew: false,
    };
  }

  return {
    guestId: crypto.randomUUID(),
    isNew: true,
  };
}

/* =========================================================
   Get Auth Token
========================================================= */

function getAuthToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (
    authorization &&
    authorization.toLowerCase().startsWith("bearer ")
  ) {
    const token = authorization.slice(7).trim();

    if (token) return token;
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);

  for (const cookieName of AUTH_COOKIE_NAMES) {
    const token = cookies[cookieName]?.trim();

    if (token) return token;
  }

  return null;
}

/* =========================================================
   Get Current User
========================================================= */

async function getCurrentUser(
  request: Request
): Promise<AuthUser | null> {
  const token = getAuthToken(request);

  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  const { data: session, error: sessionError } = await supabase
    .from("auth_sessions")
    .select(`id, user_id, token_hash, expires_at`)
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError || !session) return null;

  const { data: user, error: userError } = await supabase
    .from("users")
    .select(
      `id, full_name, username, phone, national_id, email, role, is_active`
    )
    .eq("id", session.user_id)
    .maybeSingle();

  if (userError || !user || user.is_active === false) {
    return null;
  }

  return user as AuthUser;
}

/* =========================================================
   Prepare Identity
========================================================= */

async function prepareIdentity(
  request: Request
): Promise<{
  identity: RequestIdentity;
  isNewGuest: boolean;
}> {
  const user = await getCurrentUser(request);

  if (user) {
    return {
      identity: {
        user,
        userId: user.id,
        guestId: null,
      },
      isNewGuest: false,
    };
  }

  const { guestId, isNew } = getOrCreateGuestId(request);

  return {
    identity: {
      user: null,
      userId: null,
      guestId,
    },
    isNewGuest: isNew,
  };
}

/* =========================================================
   Active Subscription
========================================================= */

async function getActiveSubscription(
  userId: string
): Promise<SubscriptionInfo | null> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(`
      id,
      user_id,
      plan_id,
      start_date,
      end_date,
      status,
      plan:plans (
        id,
        name,
        monthly_limit,
        daily_limit,
        price,
        duration_days,
        is_active,
        features
      )
    `)
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Subscription] Lookup error:", error);
    throw new Error("تعذر التحقق من الاشتراك");
  }

  if (!data) return null;

  const rawPlan = Array.isArray(data.plan)
    ? data.plan[0]
    : data.plan;

  if (!rawPlan) return null;

  return {
    id: data.id,
    user_id: data.user_id,
    plan_id: data.plan_id,
    start_date: data.start_date,
    end_date: data.end_date,
    status: data.status,
    plan: {
      id: rawPlan.id,
      name: rawPlan.name,
      monthly_limit: rawPlan.monthly_limit,
      daily_limit: rawPlan.daily_limit,
      price: rawPlan.price,
      duration_days: rawPlan.duration_days,
      is_active: rawPlan.is_active,
      features: rawPlan.features,
    },
  };
}

/* =========================================================
   Daily Usage
========================================================= */

async function countDailyUsage(
  userId: string | null,
  guestId: string | null
): Promise<number> {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );

  const startIso = start.toISOString();

  let query = supabase
    .from("usage")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("action", USAGE_ACTION)
    .gte("created_at", startIso);

  if (userId) {
    query = query.eq("user_id", userId);
  } else if (guestId) {
    query = query.eq("guest_id", guestId);
  } else {
    return 0;
  }

  const { count, error } = await query;

  if (error) {
    console.error("[Usage] Daily count error:", error);
    throw new Error("تعذر التحقق من عدد الاستخدامات اليومية");
  }

  return count ?? 0;
}

/* =========================================================
   Monthly Usage
========================================================= */

async function countMonthlyUsage(userId: string): Promise<number> {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0
  );

  const startIso = start.toISOString();

  const { count, error } = await supabase
    .from("usage")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("user_id", userId)
    .eq("action", USAGE_ACTION)
    .gte("created_at", startIso);

  if (error) {
    console.error("[Usage] Monthly count error:", error);
    throw new Error("تعذر التحقق من الاستخدام الشهري");
  }

  return count ?? 0;
}

/* =========================================================
   Check Usage Permission
========================================================= */

async function checkUsagePermission(
  identity: RequestIdentity
): Promise<{
  allowed: boolean;
  userType: "guest" | "subscriber";
  usedToday: number;
  dailyLimit: number;
  usedThisMonth?: number;
  monthlyLimit?: number;
  subscription?: SubscriptionInfo | null;
  reason?: string;
}> {
  if (!identity.userId) {
    const usedToday = await countDailyUsage(
      null,
      identity.guestId
    );

    const allowed = usedToday < GUEST_DAILY_LIMIT;

    return {
      allowed,
      userType: "guest",
      usedToday,
      dailyLimit: GUEST_DAILY_LIMIT,
      reason: allowed
        ? undefined
        : "لقد وصلت إلى الحد اليومي للزائر (3 ملفات). سجل الدخول للاستمتاع بمزيد من التحليلات.",
    };
  }

  const subscription = await getActiveSubscription(
    identity.userId
  );

  if (!subscription) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday: await countDailyUsage(
        identity.userId,
        null
      ),
      dailyLimit: 0,
      subscription: null,
      reason:
        "لا يوجد اشتراك فعال. يرجى الاشتراك أو تجديد الاشتراك للاستمرار في استخدام خدمات التحليل.",
    };
  }

  if (subscription.plan.is_active === false) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday: await countDailyUsage(
        identity.userId,
        null
      ),
      dailyLimit: 0,
      subscription,
      reason: "الباقة الحالية غير مفعلة.",
    };
  }

  const dailyLimit = Number(
    subscription.plan.daily_limit ?? 0
  );

  const monthlyLimit = Number(
    subscription.plan.monthly_limit ?? 0
  );

  const usedToday = await countDailyUsage(
    identity.userId,
    null
  );

  if (dailyLimit > 0 && usedToday >= dailyLimit) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday,
      dailyLimit,
      subscription,
      reason: `لقد وصلت إلى الحد اليومي (${dailyLimit}) لباقة "${subscription.plan.name}". حاول غداً أو قم بترقية باقتك.`,
    };
  }

  const usedThisMonth = await countMonthlyUsage(
    identity.userId
  );

  if (
    monthlyLimit > 0 &&
    usedThisMonth >= monthlyLimit
  ) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday,
      dailyLimit,
      usedThisMonth,
      monthlyLimit,
      subscription,
      reason: `لقد وصلت إلى الحد الشهري (${monthlyLimit}) لباقة "${subscription.plan.name}". قم بتجديد الاشتراك أو ترقية الباقة.`,
    };
  }

  return {
    allowed: true,
    userType: "subscriber",
    usedToday,
    dailyLimit,
    usedThisMonth,
    monthlyLimit,
    subscription,
  };
}

/* =========================================================
   Record Usage
========================================================= */

async function recordUsage(
  identity: RequestIdentity
): Promise<void> {
  const { error } = await supabase.from("usage").insert({
    user_id: identity.userId,
    guest_id: identity.guestId,
    action: USAGE_ACTION,
  });

  if (error) {
    console.error("[Usage] Insert error:", error);
    throw new Error("فشل تسجيل استخدام التحليل");
  }
}

/* =========================================================
   Response With Guest Cookie
========================================================= */

function responseWithGuestCookie(
  body: Record<string, unknown>,
  status: number,
  identity: RequestIdentity,
  isNewGuest: boolean
): NextResponse {
  const response = NextResponse.json(body, {
    status,
  });

  if (
    !identity.userId &&
    identity.guestId &&
    isNewGuest
  ) {
    response.cookies.set(
      GUEST_COOKIE_NAME,
      identity.guestId,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: GUEST_COOKIE_MAX_AGE,
        path: "/",
      }
    );
  }

  return response;
}

/* =========================================================
   POST
========================================================= */

export async function POST(request: Request) {
  let documentId: string | null = null;
  let identity: RequestIdentity | null = null;
  let isNewGuest = false;

  /*
   * مجلد مؤقت خاص بكل طلب.
   *
   * Local:
   *   C:\Users\...\AppData\Local\Temp\ai-learning-uploads\UUID
   *
   * Vercel:
   *   /tmp/ai-learning-uploads/UUID
   *
   * لا نعتمد نهائيًا على مجلد المشروع uploads/
   */
  const tempRoot = path.join(
    os.tmpdir(),
    "ai-learning-uploads"
  );

  const tempRequestDir = path.join(
    tempRoot,
    crypto.randomUUID()
  );

  try {
    /* =====================================================
       إنشاء مجلد مؤقت قابل للكتابة
    ===================================================== */

    await mkdir(tempRequestDir, {
      recursive: true,
    });

    console.log(
      `[Documents] Temporary directory: ${tempRequestDir}`
    );

    /* =====================================================
       Identity
    ===================================================== */

    const prepared = await prepareIdentity(request);

    identity = prepared.identity;
    isNewGuest = prepared.isNewGuest;

    console.log(
      "[Documents] Identity:",
      identity.userId
        ? `user:${identity.userId}`
        : `guest:${identity.guestId}`
    );

    /* =====================================================
       Read FormData
    ===================================================== */

    const formData = await request.formData();

    const file = formData.get("file");

    const lang =
      formData.get("lang") === "en"
        ? "en"
        : "ar";

    if (!(file instanceof File)) {
      return responseWithGuestCookie(
        {
          success: false,
          error: "لم يتم إرسال ملف",
        },
        400,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       File Information
    ===================================================== */

    const originalFileName = file.name;

    const lowerFileName =
      originalFileName.toLowerCase();

    const extension =
      path.extname(lowerFileName);

    const supportedExtensions = [
      ".pdf",
      ".docx",
      ".pptx",
      ".txt",
      ".mp4",
      ".webm",
      ".mov",
      ".avi",
      ".wmv",
      ".mkv",
      ".mp3",
      ".wav",
      ".m4a",
      ".ogg",
      ".flac",
      ".aac",
      ".wma",
    ];

    if (!supportedExtensions.includes(extension)) {
      return responseWithGuestCookie(
        {
          success: false,
          error: "نوع الملف غير مدعوم حاليًا",
          fileName: originalFileName,
          fileType: file.type,
        },
        400,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Read File & Hash
    ===================================================== */

    const bytes = await file.arrayBuffer();

    const buffer = Buffer.from(bytes);

    const fileHash = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    const safeFileName =
      path.basename(originalFileName);

    const storageFileName =
      `${crypto.randomUUID()}${extension}`;

    const storagePath =
      `${fileHash}/${storageFileName}`;

    /* =====================================================
       Check Existing Document
    ===================================================== */

    let existingQuery = supabase
      .from("documents")
      .select(`
        id,
        file_name,
        file_hash,
        file_path,
        file_type,
        media_type,
        file_size,
        extracted_text,
        analysis,
        status,
        error_message,
        user_id,
        guest_id,
        created_at,
        updated_at
      `)
      .eq("file_hash", fileHash);

    if (identity.userId) {
      existingQuery =
        existingQuery.eq(
          "user_id",
          identity.userId
        );
    } else if (identity.guestId) {
      existingQuery = existingQuery
        .eq("guest_id", identity.guestId)
        .is("user_id", null);
    } else {
      existingQuery = existingQuery.eq(
        "id",
        "00000000-0000-0000-0000-000000000000"
      );
    }

    const {
      data: existingDocument,
      error: existingDocumentError,
    } = await existingQuery.maybeSingle();

    if (existingDocumentError) {
      console.error(
        "[Documents] Existing document lookup error:",
        existingDocumentError
      );

      throw new Error(
        "تعذر البحث عن الملف في قاعدة البيانات"
      );
    }

    /* =====================================================
       Existing Completed Document
    ===================================================== */

    if (
      existingDocument &&
      existingDocument.status === "completed"
    ) {
      const analysisSummary =
        existingDocument.analysis?.summary || "";

      const isSavedInArabic =
        containsArabic(analysisSummary);

      if (
        lang === "en" &&
        isSavedInArabic
      ) {
        console.log(
          `[Documents] إعادة تحليل الملف باللغة الإنجليزية: ${originalFileName}`
        );

        const newAnalysis =
          await analyzeDocument(
            existingDocument.extracted_text || "",
            "en"
          );

        const {
          error: updateError,
        } = await supabase
          .from("documents")
          .update({
            analysis: newAnalysis,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingDocument.id);

        if (updateError) {
          throw new Error(
            `فشل حفظ التحليل الجديد: ${updateError.message}`
          );
        }

        return responseWithGuestCookie(
          {
            success: true,
            existing: true,
            documentId: existingDocument.id,
            fileName: existingDocument.file_name,
            mediaType: existingDocument.media_type,
            textLength:
              existingDocument.extracted_text
                ?.length ?? 0,
            text:
              existingDocument.extracted_text
                ?.substring(0, 1000) ?? "",
            analysis: newAnalysis,
            usageCharged: false,
            message:
              "لديك هذا الملف بالفعل، ولكن تم تحليله بالعربية. تم إعادة تحليله بالإنجليزية بنجاح.",
          },
          200,
          identity,
          isNewGuest
        );
      }

      if (
        lang === "ar" &&
        !isSavedInArabic &&
        analysisSummary.length > 20
      ) {
        console.log(
          `[Documents] إعادة تحليل الملف باللغة العربية: ${originalFileName}`
        );

        const newAnalysis =
          await analyzeDocument(
            existingDocument.extracted_text || "",
            "ar"
          );

        const {
          error: updateError,
        } = await supabase
          .from("documents")
          .update({
            analysis: newAnalysis,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingDocument.id);

        if (updateError) {
          throw new Error(
            `فشل حفظ التحليل الجديد: ${updateError.message}`
          );
        }

        return responseWithGuestCookie(
          {
            success: true,
            existing: true,
            documentId: existingDocument.id,
            fileName: existingDocument.file_name,
            mediaType: existingDocument.media_type,
            textLength:
              existingDocument.extracted_text
                ?.length ?? 0,
            text:
              existingDocument.extracted_text
                ?.substring(0, 1000) ?? "",
            analysis: newAnalysis,
            usageCharged: false,
            message:
              "لديك هذا الملف بالفعل، ولكن تم تحليله بالإنجليزية. تم إعادة تحليله بالعربية بنجاح.",
          },
          200,
          identity,
          isNewGuest
        );
      }

      console.log(
        `[Documents] الملف موجود بالفعل لنفس المستخدم بنفس اللغة: ${originalFileName}`
      );

      return responseWithGuestCookie(
        {
          success: true,
          existing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          mediaType: existingDocument.media_type,
          textLength:
            existingDocument.extracted_text?.length ?? 0,
          text:
            existingDocument.extracted_text
              ?.substring(0, 1000) ?? "",
          analysis: existingDocument.analysis,
          usageCharged: false,
          message:
            "لديك بالفعل ملف بنفس المحتوى تم تحليله مسبقًا. تم استرجاع التحليل المحفوظ.",
        },
        200,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Existing Processing
    ===================================================== */

    if (
      existingDocument &&
      existingDocument.status === "processing"
    ) {
      return responseWithGuestCookie(
        {
          success: true,
          existing: true,
          processing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          message:
            "الملف موجود بالفعل وما زال قيد المعالجة، يرجى الانتظار قليلاً.",
        },
        200,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Existing Uploaded Video
    ===================================================== */

    if (
      existingDocument &&
      existingDocument.status === "uploaded"
    ) {
      return responseWithGuestCookie(
        {
          success: true,
          existing: true,
          documentId: existingDocument.id,
          fileName: existingDocument.file_name,
          mediaType: existingDocument.media_type,
          usageCharged: false,
          message:
            "الملف موجود بالفعل وتم رفعه مسبقًا.",
        },
        200,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Failed Document
    ===================================================== */

    if (
      existingDocument &&
      existingDocument.status === "failed"
    ) {
      console.log(
        `[Documents] حذف السجل الفاشل وإعادة المحاولة: ${fileHash}`
      );

      const {
        error: deleteError,
      } = await supabase
        .from("documents")
        .delete()
        .eq("id", existingDocument.id);

      if (deleteError) {
        throw new Error(
          "تعذر حذف السجل السابق للملف"
        );
      }
    }

    /* =====================================================
       Check Usage Limit
    ===================================================== */

    const usage =
      await checkUsagePermission(identity);

    console.log("[Usage]", {
      userType: usage.userType,
      usedToday: usage.usedToday,
      dailyLimit: usage.dailyLimit,
      usedThisMonth: usage.usedThisMonth,
      monthlyLimit: usage.monthlyLimit,
      allowed: usage.allowed,
    });

    if (!usage.allowed) {
      return responseWithGuestCookie(
        {
          success: false,
          limitReached: true,
          subscriptionExpired: Boolean(
            identity.userId &&
              !usage.subscription
          ),
          userType: usage.userType,
          usedToday: usage.usedToday,
          dailyLimit: usage.dailyLimit,
          usedThisMonth:
            usage.usedThisMonth ?? null,
          monthlyLimit:
            usage.monthlyLimit ?? null,
          plan:
            usage.subscription?.plan?.name ??
            null,
          error:
            usage.reason ||
            "تم الوصول إلى حد الاستخدام.",
        },
        403,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Temporary Local File
       Vercel /tmp + Local OS temp folder
    ===================================================== */

    const localFileName =
      `${fileHash}-${safeFileName}`;

    const filePath = path.join(
      tempRequestDir,
      localFileName
    );

    await writeFile(
      filePath,
      buffer
    );

    console.log(
      `[Documents] تم حفظ الملف مؤقتًا: ${filePath}`
    );

    /* =====================================================
       Media Type Detection
    ===================================================== */

    const videoExtensions = [
      ".mp4",
      ".webm",
      ".mov",
      ".avi",
      ".mkv",
      ".wmv",
    ];

    const audioExtensions = [
      ".mp3",
      ".wav",
      ".m4a",
      ".ogg",
      ".flac",
      ".aac",
      ".wma",
    ];

    const isVideo =
      videoExtensions.includes(extension);

    const isAudio =
      audioExtensions.includes(extension);

    const isMedia =
      isVideo || isAudio;

    const mediaType =
      isMedia ? "media" : "document";

    /* =====================================================
       Supabase Storage
    ===================================================== */

    console.log(
      `[Documents] رفع الملف إلى Supabase Storage: ${storagePath}`
    );

    const {
      error: storageError,
    } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(
        storagePath,
        buffer,
        {
          contentType:
            file.type ||
            "application/octet-stream",
          cacheControl: "3600",
          upsert: false,
        }
      );

    if (
      storageError &&
      !storageError.message
        .toLowerCase()
        .includes("already exists")
    ) {
      throw new Error(
        `فشل رفع الملف إلى Supabase Storage: ${storageError.message}`
      );
    }

    /* =====================================================
       Media → Transcription
    ===================================================== */

    let text = "";

    if (isMedia) {
      let audioFilePath = filePath;

      /* -----------------------------------------------
         Video → Extract Audio
      ------------------------------------------------ */

      if (isVideo) {
        console.log(
          `[Documents] استخراج الصوت من الفيديو: ${originalFileName}`
        );

        audioFilePath = path.join(
          tempRequestDir,
          `${fileHash}.wav`
        );

        await extractAudioFromVideo(
          filePath,
          audioFilePath
        );
      }

      /* -----------------------------------------------
         Audio/Video → Gemini Transcription
      ------------------------------------------------ */

      console.log(
        `[Documents] بدء نسخ الصوت إلى نص باستخدام الذكاء الاصطناعي: ${originalFileName}`
      );

      text =
        await transcribeAudioToText(
          audioFilePath,
          lang
        );

      if (!text.trim()) {
        return responseWithGuestCookie(
          {
            success: false,
            error:
              "لم يتم استخراج أي نص من الملف الصوتي أو الفيديو. تأكد من أن الملف يحتوي على كلام واضح.",
            fileName: originalFileName,
          },
          422,
          identity,
          isNewGuest
        );
      }
    }

    /* =====================================================
       Extract Text
    ===================================================== */

    if (!isMedia) {
      if (extension === ".pdf") {
        text =
          await extractPdfText(
            filePath
          );
      } else if (
        extension === ".docx"
      ) {
        text =
          await extractWordText(
            filePath
          );
      } else if (
        extension === ".pptx"
      ) {
        text =
          await extractPowerPointText(
            filePath
          );
      } else if (
        extension === ".txt"
      ) {
        text =
          buffer.toString("utf-8");
      }
    }

    /* =====================================================
       Validate Extracted Text
    ===================================================== */

    if (!text.trim()) {
      return responseWithGuestCookie(
        {
          success: false,
          error:
            "تم رفع الملف ولكن لم يتم استخراج أي نص منه. تأكد من أن الملف ليس فارغاً أو صورة ممسوحة ضعيفاً.",
          fileName: originalFileName,
        },
        422,
        identity,
        isNewGuest
      );
    }

    /* =====================================================
       Insert Processing Document
    ===================================================== */

    const {
      data: insertedDocument,
      error: insertDocumentError,
    } = await supabase
      .from("documents")
      .insert({
        file_name: originalFileName,
        file_hash: fileHash,
        file_path: storagePath,
        file_type:
          file.type || extension,
        media_type: mediaType,
        file_size: buffer.length,
        extracted_text: text,
        analysis: null,
        status: "processing",
        error_message: null,
        user_id: identity.userId,
        guest_id: identity.guestId,
      })
      .select()
      .single();

    if (insertDocumentError) {
      throw new Error(
        `فشل حفظ المستند في قاعدة البيانات: ${insertDocumentError.message}`
      );
    }

    documentId =
      insertedDocument.id;

    /* =====================================================
       Record Usage
    ===================================================== */

    await recordUsage(identity);

    console.log(
      `[Usage] تم تسجيل محاولة التحليل للمستخدم: ${
        identity.userId ||
        identity.guestId
      }`
    );

    /* =====================================================
       AI Analysis
    ===================================================== */

    console.log(
      `[Documents] بدء تحليل Gemini باللغة: ${lang}...`
    );

    const analysis =
      await analyzeDocument(
        text,
        lang
      );

    /* =====================================================
       Save Analysis
    ===================================================== */

    const {
      error: updateDocumentError,
    } = await supabase
      .from("documents")
      .update({
        analysis,
        status: "completed",
        error_message: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", documentId);

    if (updateDocumentError) {
      throw new Error(
        `تم التحليل ولكن فشل حفظ التحليل: ${updateDocumentError.message}`
      );
    }

    console.log(
      `[Documents] تم حفظ التحليل بنجاح: ${documentId}`
    );

    /* =====================================================
       Final Usage
    ===================================================== */

    const finalUsage =
      await checkUsagePermission(
        identity
      );

    /* =====================================================
       Success
    ===================================================== */

    return responseWithGuestCookie(
      {
        success: true,
        existing: false,
        documentId,
        fileName: originalFileName,
        mediaType,
        textLength: text.length,
        text: text.substring(0, 1000),
        analysis,
        usage: {
          userType:
            finalUsage.userType,
          usedToday:
            finalUsage.usedToday,
          dailyLimit:
            finalUsage.dailyLimit,
          usedThisMonth:
            finalUsage.usedThisMonth ??
            null,
          monthlyLimit:
            finalUsage.monthlyLimit ??
            null,
          plan:
            finalUsage.subscription
              ?.plan?.name ??
            null,
        },
        usageCharged: true,
        message: isMedia
          ? "تم رفع الملف الصوتي/الفيديو واستخراج النص وتحليله بنجاح."
          : "تم رفع الملف وتحليله وحفظه بنجاح.",
      },
      200,
      identity,
      isNewGuest
    );
  } catch (error) {
    console.error(
      "[Documents] File processing error:",
      error
    );

    /* =====================================================
       Mark Document Failed
    ===================================================== */

    if (documentId) {
      try {
        await supabase
          .from("documents")
          .update({
            status: "failed",
            error_message:
              error instanceof Error
                ? error.message
                : "حدث خطأ غير معروف",
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", documentId);
      } catch (databaseError) {
        console.error(
          "[Documents] Failed to update document status:",
          databaseError
        );
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : "حدث خطأ غير معروف";

    const lowerMessage =
      message.toLowerCase();

    const isGeminiQuota =
      lowerMessage.includes("quota") ||
      lowerMessage.includes("429") ||
      lowerMessage.includes("rate limit") ||
      lowerMessage.includes("resource exhausted");

    return responseWithGuestCookie(
      {
        success: false,
        error: isGeminiQuota
          ? "خدمة الذكاء الاصطناعي وصلت إلى الحد المتاح حاليًا. حاول مرة أخرى لاحقًا."
          : "حدث خطأ أثناء معالجة الملف، يرجى المحاولة مرة أخرى.",
        details: message,
        geminiQuota: isGeminiQuota,
        documentId,
      },
      500,
      identity || {
        user: null,
        userId: null,
        guestId: null,
      },
      isNewGuest
    );
  } finally {
    /* =====================================================
       Cleanup Temporary Files
    ===================================================== */

    try {
      await rm(
        tempRequestDir,
        {
          recursive: true,
          force: true,
        }
      );

      console.log(
        `[Documents] تم تنظيف الملفات المؤقتة: ${tempRequestDir}`
      );
    } catch (cleanupError) {
      console.warn(
        "[Documents] تعذر تنظيف الملفات المؤقتة:",
        cleanupError
      );
    }
  }
}