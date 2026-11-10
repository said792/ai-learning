import { cookies } from "next/headers";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";
import { getEffectiveSubscription } from "@/lib/subscription";

/* =========================================================
   نظام الاستخدام الموحد — المصدر الوحيد للهوية والكوتة
   (كانت هناك نسختان متضاربتان سابقًا، تم توحيدهما هنا)
========================================================= */

/** كوكي الزائر — الاسم الوحيد المعتمد في كل التطبيق */
export const GUEST_COOKIE = "ai_guest_id";
export const SESSION_COOKIE = "ai_learning_session";

export type UsageAction =
  | "document_analysis"
  | "chat"
  | "tts_lesson"
  | "video_lesson";

const GUEST_DAILY_LIMIT = Number(process.env.GUEST_DAILY_LIMIT ?? 3);
const CHAT_GUEST_DAILY_LIMIT = Number(process.env.CHAT_GUEST_DAILY_LIMIT ?? 10);
const CHAT_USER_DAILY_LIMIT = Number(process.env.CHAT_USER_DAILY_LIMIT ?? 100);

export type AccessInfo = {
  type: "guest" | "subscriber";
  userId: string | null;
  guestId: string | null;
  planId: string | null;
  planName: string | null;
  /** سعر الباقة — 0 يعني مجانية (مش بتشمل توليد الدروس) */
  price: number | null;
  limit: number | null;
  used: number;
  remaining: number | null;
  allowed: boolean;
};

/* =========================================================
   Guest ID
========================================================= */

export async function ensureGuestId(): Promise<string> {
  const cookieStore = await cookies();

  let guestId = cookieStore.get(GUEST_COOKIE)?.value;

  if (!guestId) {
    guestId = crypto.randomUUID();

    cookieStore.set({
      name: GUEST_COOKIE,
      value: guestId,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return guestId;
}

/** قراءة هوية الزائر من request مباشرة (للـ routes التي تبني response يدويًا) */
export function readGuestIdFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie") || "";

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;

    const key = part.slice(0, idx).trim();
    if (key !== GUEST_COOKIE) continue;

    const value = part.slice(idx + 1).trim();
    if (value) return value;
  }

  return null;
}

/* =========================================================
   Current User
========================================================= */

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();

  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) return null;

  return getUserIdByToken(token);
}

export async function getUserIdByToken(
  token: string
): Promise<string | null> {
  const tokenHash = hashSessionToken(token);

  const { data: session, error } = await supabaseAdmin
    .from("auth_sessions")
    .select("user_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !session) return null;

  if (!session.expires_at || new Date(session.expires_at) <= new Date()) {
    return null;
  }

  return session.user_id;
}

/* =========================================================
   الاشتراك الفعال + حدود الباقة
========================================================= */

export type ActivePlan = {
  id: string;
  name: string;
  price: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  tts_daily_limit: number | null;
  video_daily_limit: number | null;
};

export async function getActivePlan(userId: string): Promise<ActivePlan | null> {
  /* الاشتراك الفعّال: الباقة المدفوعة السارية أولًا، وإلا الخطة المجانية
     (بعد انتهاء المدفوع المستخدم بيرجع للمجانية تلقائيًا) */
  const sub = await getEffectiveSubscription(
    userId,
    `id, plan_id,
     plans ( id, name, price, daily_limit, monthly_limit, tts_daily_limit, video_daily_limit )`
  );

  if (!sub) return null;

  const rawPlan = Array.isArray(sub.plans)
    ? (sub.plans as Array<Record<string, unknown>>)[0]
    : (sub.plans as Record<string, unknown> | null);

  if (!rawPlan) return null;

  return {
    id: String(rawPlan.id),
    name: String(rawPlan.name ?? ""),
    price: Number(rawPlan.price ?? 0),
    daily_limit: (rawPlan.daily_limit as number | null) ?? null,
    monthly_limit: (rawPlan.monthly_limit as number | null) ?? null,
    tts_daily_limit: (rawPlan.tts_daily_limit as number | null) ?? null,
    video_daily_limit: (rawPlan.video_daily_limit as number | null) ?? null,
  };
}

/* =========================================================
   حدود كل إجراء
========================================================= */

function startOfToday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function startOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

async function countUsage(options: {
  userId: string | null;
  guestId: string | null;
  action: UsageAction;
  since: string;
}): Promise<number> {
  let query = supabaseAdmin
    .from("usage")
    .select("id", { count: "exact", head: true })
    .eq("action", options.action)
    .gte("created_at", options.since);

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  } else if (options.guestId) {
    query = query.eq("guest_id", options.guestId);
  } else {
    return 0;
  }

  const { count, error } = await query;

  if (error) {
    console.error("[Usage] Count error:", error);
    throw new Error("تعذر التحقق من الاستخدام");
  }

  return count ?? 0;
}

/**
 * التحقق من الصلاحية والكوتة لأي إجراء.
 *
 * قواعد الحدود:
 * - document_analysis: الزائر 3/يوم، المشترك daily_limit ثم monthly_limit (null = غير محدود)
 * - chat: الزائر 10/يوم، المستخدم 100/يوم (قابلة للضبط بـ env)
 * - tts_lesson / video_lesson: للزوار ممنوع، وللمشتركين plan.tts_daily_limit / video_daily_limit
 *   (null أو -1 = غير محدود، 0 = ممنوع، > 0 = حد يومي)
 */
export async function checkQuota(
  action: UsageAction,
  identity: { userId: string | null; guestId: string | null }
): Promise<AccessInfo> {
  // ===== الزائر =====
  if (!identity.userId) {
    if (action === "tts_lesson" || action === "video_lesson") {
      return {
        type: "guest",
        userId: null,
        guestId: identity.guestId,
        planId: null,
        planName: null,
        price: null,
        limit: 0,
        used: 0,
        remaining: 0,
        allowed: false,
      };
    }

    const limit =
      action === "chat" ? CHAT_GUEST_DAILY_LIMIT : GUEST_DAILY_LIMIT;

    const used = await countUsage({
      userId: null,
      guestId: identity.guestId,
      action,
      since: startOfToday(),
    });

    return {
      type: "guest",
      userId: null,
      guestId: identity.guestId,
      planId: null,
      planName: null,
      price: null,
      limit,
      used,
      remaining: Math.max(limit - used, 0),
      allowed: used < limit,
    };
  }

  // ===== المستخدم =====
  const plan = await getActivePlan(identity.userId);

  // شات: حد عام للمستخدمين المسجلين حتى لو انتهت باقتهم
  if (action === "chat") {
    const used = await countUsage({
      userId: identity.userId,
      guestId: null,
      action,
      since: startOfToday(),
    });

    return {
      type: "subscriber",
      userId: identity.userId,
      guestId: null,
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      price: plan?.price ?? null,
      limit: CHAT_USER_DAILY_LIMIT,
      used,
      remaining: Math.max(CHAT_USER_DAILY_LIMIT - used, 0),
      allowed: used < CHAT_USER_DAILY_LIMIT,
    };
  }

  if (!plan) {
    // المستخدم مسجل لكن بلا اشتراك فعال — نتعامل معه كزائر
    if (action !== "document_analysis") {
      return {
        type: "guest",
        userId: identity.userId,
        guestId: null,
        planId: null,
        planName: null,
        price: null,
        limit: 0,
        used: 0,
        remaining: 0,
        allowed: false,
      };
    }

    const used = await countUsage({
      userId: identity.userId,
      guestId: null,
      action,
      since: startOfToday(),
    });

    return {
      type: "guest",
      userId: identity.userId,
      guestId: null,
      planId: null,
      planName: null,
      price: null,
      limit: GUEST_DAILY_LIMIT,
      used,
      remaining: Math.max(GUEST_DAILY_LIMIT - used, 0),
      allowed: used < GUEST_DAILY_LIMIT,
    };
  }

  // دروس صوتية / مرئية — للباقات المدفوعة فقط (قرار تصميمي: الحصة المجانية مفيهاش توليد دروس)
  if (action === "tts_lesson" || action === "video_lesson") {
    const isFreePlan = Number(plan.price) === 0;

    if (isFreePlan) {
      return {
        type: "subscriber",
        userId: identity.userId,
        guestId: null,
        planId: plan.id,
        planName: plan.name,
        price: 0,
        limit: 0,
        used: 0,
        remaining: 0,
        allowed: false,
      };
    }

    const rawLimit =
      action === "tts_lesson" ? plan.tts_daily_limit : plan.video_daily_limit;

    // null أو -1 = غير محدود
    if (rawLimit === null || rawLimit === undefined || Number(rawLimit) === -1) {
      return {
        type: "subscriber",
        userId: identity.userId,
        guestId: null,
        planId: plan.id,
        planName: plan.name,
        price: Number(plan.price),
        limit: null,
        used: 0,
        remaining: null,
        allowed: true,
      };
    }

    const limit = Number(rawLimit);

    const used = await countUsage({
      userId: identity.userId,
      guestId: null,
      action,
      since: startOfToday(),
    });

    return {
      type: "subscriber",
      userId: identity.userId,
      guestId: null,
      planId: plan.id,
      planName: plan.name,
      price: Number(plan.price),
      limit,
      used,
      remaining: Math.max(limit - used, 0),
      allowed: used < limit,
    };
  }

  // ===== تحليل المستندات (كما كان) =====
  if (plan.daily_limit !== null && plan.daily_limit !== undefined) {
    const used = await countUsage({
      userId: identity.userId,
      guestId: null,
      action,
      since: startOfToday(),
    });

    return {
      type: "subscriber",
      userId: identity.userId,
      guestId: null,
      planId: plan.id,
      planName: plan.name,
      price: Number(plan.price),
      limit: plan.daily_limit,
      used,
      remaining: Math.max(plan.daily_limit - used, 0),
      allowed: used < plan.daily_limit,
    };
  }

  if (plan.monthly_limit !== null && plan.monthly_limit !== undefined) {
    const used = await countUsage({
      userId: identity.userId,
      guestId: null,
      action,
      since: startOfMonth(),
    });

    return {
      type: "subscriber",
      userId: identity.userId,
      guestId: null,
      planId: plan.id,
      planName: plan.name,
      price: Number(plan.price),
      limit: plan.monthly_limit,
      used,
      remaining: Math.max(plan.monthly_limit - used, 0),
      allowed: used < plan.monthly_limit,
    };
  }

  return {
    type: "subscriber",
    userId: identity.userId,
    guestId: null,
    planId: plan.id,
    planName: plan.name,
    price: Number(plan.price),
    limit: null,
    used: 0,
    remaining: null,
    allowed: true,
  };
}

/* =========================================================
   تسجيل الاستخدام
========================================================= */

export async function recordUsage(
  action: UsageAction,
  identity: { userId: string | null; guestId: string | null }
): Promise<void> {
  const { error } = await supabaseAdmin.from("usage").insert({
    user_id: identity.userId,
    guest_id: identity.guestId,
    action,
  });

  if (error) {
    console.error("[Usage] Insert error:", error);
    throw new Error("فشل تسجيل الاستخدام");
  }
}
