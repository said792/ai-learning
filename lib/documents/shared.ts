import { NextResponse } from "next/server";

import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { ensureFreeSubscription, getEffectiveSubscription } from "@/lib/subscription";
import { hashSessionToken } from "@/lib/auth";

/* =========================================================
   الدوال المشتركة لخط رفع المستندات
   (منقولة من app/api/documents/upload/route.ts كما هي
    لتتشاركها مسارات init و complete بدون تكرار)
========================================================= */

export const GUEST_DAILY_LIMIT = 3;
export const USAGE_ACTION = "document_analysis";

export const AUTH_COOKIE_NAMES = [
  "ai_learning_session",
  "auth_token",
  "session_token",
  "access_token",
  "token",
];

export const GUEST_COOKIE_NAME = "ai_guest_id";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/* =========================================================
   Types
========================================================= */

export type AuthUser = {
  id: string;
  full_name?: string | null;
  username?: string | null;
  phone?: string | null;
  national_id?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
};

export type SubscriptionInfo = {
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

export type RequestIdentity = {
  user: AuthUser | null;
  userId: string | null;
  guestId: string | null;
};

/* =========================================================
   Arabic Detection
========================================================= */

export function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/* =========================================================
   Cookie Parser
========================================================= */

export function parseCookies(cookieHeader: string): Record<string, string> {
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
======================================================== */

export function getOrCreateGuestId(request: Request): { guestId: string; isNew: boolean } {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const existingGuestId = cookies[GUEST_COOKIE_NAME]?.trim();

  if (existingGuestId) {
    return { guestId: existingGuestId, isNew: false };
  }

  return { guestId: crypto.randomUUID(), isNew: true };
}

/* =========================================================
   Get Auth Token
======================================================== */

export function getAuthToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
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
======================================================== */

export async function getCurrentUser(request: Request): Promise<AuthUser | null> {
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
    .select(`id, full_name, username, phone, national_id, email, role, is_active`)
    .eq("id", session.user_id)
    .maybeSingle();

  if (userError || !user || user.is_active === false) return null;

  return user as AuthUser;
}

/* =========================================================
   Prepare Identity
======================================================== */

export async function prepareIdentity(
  request: Request
): Promise<{ identity: RequestIdentity; isNewGuest: boolean }> {
  const user = await getCurrentUser(request);
  if (user) {
    return {
      identity: { user, userId: user.id, guestId: null },
      isNewGuest: false,
    };
  }

  const { guestId, isNew } = getOrCreateGuestId(request);
  return {
    identity: { user: null, userId: null, guestId },
    isNewGuest: isNew,
  };
}

/* =========================================================
   Active Subscription
======================================================== */

export async function getActiveSubscription(userId: string): Promise<SubscriptionInfo | null> {
  /* الاشتراك الفعّال: الباقة المدفوعة السارية أولًا، وإلا الخطة المجانية */
  const data = await getEffectiveSubscription(
    userId,
    `id, user_id, plan_id, start_date, end_date, status,
     plan:plans ( id, name, monthly_limit, daily_limit, price, duration_days, is_active, features )`
  );

  if (!data) return null;

  const rawPlan = Array.isArray(data.plan) ? data.plan[0] : data.plan;
  if (!rawPlan) return null;

  return {
    id: String(data.id),
    user_id: String(data.user_id),
    plan_id: String(data.plan_id),
    start_date: String(data.start_date),
    end_date: String(data.end_date),
    status: String(data.status),
    plan: {
      id: String(rawPlan.id),
      name: String(rawPlan.name ?? ""),
      monthly_limit: (rawPlan.monthly_limit as number | null) ?? null,
      daily_limit: (rawPlan.daily_limit as number | null) ?? null,
      price: Number(rawPlan.price ?? 0),
      duration_days: Number(rawPlan.duration_days ?? 30),
      is_active: rawPlan.is_active !== false,
      features: rawPlan.features ?? null,
    },
  };
}

/* =========================================================
   Daily Usage
======================================================== */

export async function countDailyUsage(userId: string | null, guestId: string | null): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startIso = start.toISOString();

  let query = supabase
    .from("usage")
    .select("id", { count: "exact", head: true })
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
======================================================== */

export async function countMonthlyUsage(userId: string): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const startIso = start.toISOString();

  const { count, error } = await supabase
    .from("usage")
    .select("id", { count: "exact", head: true })
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
======================================================== */

export async function checkUsagePermission(identity: RequestIdentity): Promise<{
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
    const usedToday = await countDailyUsage(null, identity.guestId);
    const allowed = usedToday < GUEST_DAILY_LIMIT;
    return {
      allowed,
      userType: "guest",
      usedToday,
      dailyLimit: GUEST_DAILY_LIMIT,
      reason: allowed ? undefined : "لقد وصلت إلى الحد اليومي للزائر (3 ملفات). سجل حساب مجاني مدى الحياة — بدون تفعيل — عشان ترفع أكتر.",
    };
  }

  let subscription = await getActiveSubscription(identity.userId);

  if (!subscription) {
    /* شفاء ذاتي: لو مفيش اشتراك ساري (نادر) — نتأكد إن الخطة المجانية مفعّلة له */
    try {
      await ensureFreeSubscription(identity.userId);
      const retry = await getActiveSubscription(identity.userId);
      if (retry) {
        subscription = retry;
      }
    } catch {
      /* تجاهل — هنرجع رسالة الاشتراك تحت */
    }

    if (!subscription) {
      return {
        allowed: false,
        userType: "subscriber",
        usedToday: await countDailyUsage(identity.userId, null),
        dailyLimit: 0,
        subscription: null,
        reason: "لا يوجد اشتراك فعال. يرجى تحديث الصفحة أو الاشتراك للاستمرار في استخدام خدمات التحليل.",
      };
    }
  }

  if (subscription.plan.is_active === false) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday: await countDailyUsage(identity.userId, null),
      dailyLimit: 0,
      subscription,
      reason: "الباقة الحالية غير مفعلة.",
    };
  }

  const dailyLimit = Number(subscription.plan.daily_limit ?? 0);
  const monthlyLimit = Number(subscription.plan.monthly_limit ?? 0);
  const usedToday = await countDailyUsage(identity.userId, null);

  if (dailyLimit > 0 && usedToday >= dailyLimit) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday,
      dailyLimit,
      subscription,
      reason: `لقد وصلت إلى أقصى عدد لرفع الملفات اليوم (${usedToday} من ${dailyLimit}) في باقة "${subscription.plan.name}". انتظر حتى الغد، أو اشترك في باقة أعلى من صفحة الاشتراكات.`,
    };
  }

  const usedThisMonth = await countMonthlyUsage(identity.userId);

  if (monthlyLimit > 0 && usedThisMonth >= monthlyLimit) {
    return {
      allowed: false,
      userType: "subscriber",
      usedToday,
      dailyLimit,
      usedThisMonth,
      monthlyLimit,
      subscription,
      reason: `لقد وصلت إلى أقصى عدد لرفع الملفات هذا الشهر (${usedThisMonth} من ${monthlyLimit}) في باقة "${subscription.plan.name}". اشترك في باقة أعلى لمزيد من الملفات.`,
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
======================================================== */

export async function recordUsage(identity: RequestIdentity): Promise<void> {
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
======================================================== */

export function responseWithGuestCookie(
  body: Record<string, unknown>,
  status: number,
  identity: RequestIdentity,
  isNewGuest: boolean
): NextResponse {
  const response = NextResponse.json(body, { status });

  if (!identity.userId && identity.guestId && isNewGuest) {
    response.cookies.set(GUEST_COOKIE_NAME, identity.guestId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: GUEST_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  return response;
}
