import { cookies } from "next/headers";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

const GUEST_DAILY_LIMIT = 3;

const GUEST_COOKIE = "ai_learning_guest";
const SESSION_COOKIE = "ai_learning_session";

export type AccessInfo = {
  type: "guest" | "subscriber";
  userId: string | null;

  planId: string | null;
  planName: string | null;

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

/* =========================================================
   Current User
========================================================= */

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();

  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const { data: session, error } = await supabaseAdmin
    .from("auth_sessions")
    .select("user_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !session) {
    return null;
  }

  if (
    !session.expires_at ||
    new Date(session.expires_at) <= new Date()
  ) {
    return null;
  }

  return session.user_id;
}

/* =========================================================
   Date Helpers
========================================================= */

function startOfToday(): string {
  const now = new Date();

  now.setHours(0, 0, 0, 0);

  return now.toISOString();
}

function startOfMonth(): string {
  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();
}

/* =========================================================
   Count Usage
========================================================= */

async function countGuestUsage(
  guestId: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("usage")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("guest_id", guestId)
    .eq("action", "analysis")
    .gte("created_at", startOfToday());

  if (error) {
    console.error(
      "[Usage] Guest usage count error:",
      error
    );

    throw new Error(
      "تعذر التحقق من استخدام الحساب"
    );
  }

  return count ?? 0;
}

async function countUserDailyUsage(
  userId: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("usage")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("user_id", userId)
    .eq("action", "analysis")
    .gte("created_at", startOfToday());

  if (error) {
    console.error(
      "[Usage] Daily usage count error:",
      error
    );

    throw new Error(
      "تعذر التحقق من استخدام الاشتراك"
    );
  }

  return count ?? 0;
}

async function countUserMonthlyUsage(
  userId: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("usage")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("user_id", userId)
    .eq("action", "analysis")
    .gte("created_at", startOfMonth());

  if (error) {
    console.error(
      "[Usage] Monthly usage count error:",
      error
    );

    throw new Error(
      "تعذر التحقق من استخدام الاشتراك"
    );
  }

  return count ?? 0;
}

/* =========================================================
   Get Access Info
========================================================= */

export async function getAccessInfo(): Promise<AccessInfo> {
  const userId = await getCurrentUserId();

  /* =======================================================
     Subscriber
  ======================================================= */

  if (userId) {
    const { data: subscription, error } =
      await supabaseAdmin
        .from("subscriptions")
        .select(`
          id,
          plan_id,
          start_date,
          end_date,
          status,
          plans (
            id,
            name,
            daily_limit,
            monthly_limit
          )
        `)
        .eq("user_id", userId)
        .eq("status", "active")
        .gt(
          "end_date",
          new Date().toISOString()
        )
        .order("end_date", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (error) {
      console.error(
        "[Usage] Subscription lookup error:",
        error
      );

      throw new Error(
        "تعذر التحقق من الاشتراك"
      );
    }

    /* =====================================================
       لا يوجد اشتراك فعال
       يرجع Guest
    ===================================================== */

    if (!subscription) {
      const guestId =
        await ensureGuestId();

      const used =
        await countGuestUsage(
          guestId
        );

      return {
        type: "guest",

        userId: null,

        planId: null,
        planName: null,

        limit:
          GUEST_DAILY_LIMIT,

        used,

        remaining:
          Math.max(
            GUEST_DAILY_LIMIT - used,
            0
          ),

        allowed:
          used <
          GUEST_DAILY_LIMIT,
      };
    }

    /* =====================================================
       Plan
    ===================================================== */

    const plan = Array.isArray(
      subscription.plans
    )
      ? subscription.plans[0]
      : subscription.plans;

    if (!plan) {
      return {
        type: "subscriber",

        userId,

        planId:
          subscription.plan_id ?? null,

        planName: null,

        limit: 0,

        used: 0,

        remaining: 0,

        allowed: false,
      };
    }

    /* =====================================================
       Daily Plan
    ===================================================== */

    if (
      plan.daily_limit !== null &&
      plan.daily_limit !== undefined
    ) {
      const used =
        await countUserDailyUsage(
          userId
        );

      return {
        type: "subscriber",

        userId,

        planId: plan.id,

        planName: plan.name,

        limit:
          plan.daily_limit,

        used,

        remaining:
          Math.max(
            plan.daily_limit - used,
            0
          ),

        allowed:
          used <
          plan.daily_limit,
      };
    }

    /* =====================================================
       Monthly Plan
    ===================================================== */

    if (
      plan.monthly_limit !== null &&
      plan.monthly_limit !== undefined
    ) {
      const used =
        await countUserMonthlyUsage(
          userId
        );

      return {
        type: "subscriber",

        userId,

        planId: plan.id,

        planName: plan.name,

        limit:
          plan.monthly_limit,

        used,

        remaining:
          Math.max(
            plan.monthly_limit - used,
            0
          ),

        allowed:
          used <
          plan.monthly_limit,
      };
    }

    /* =====================================================
       Unlimited
    ===================================================== */

    return {
      type: "subscriber",

      userId,

      planId: plan.id,

      planName: plan.name,

      limit: null,

      used: 0,

      remaining: null,

      allowed: true,
    };
  }

  /* =======================================================
     Guest
  ======================================================= */

  const guestId =
    await ensureGuestId();

  const used =
    await countGuestUsage(
      guestId
    );

  return {
    type: "guest",

    userId: null,

    planId: null,
    planName: null,

    limit:
      GUEST_DAILY_LIMIT,

    used,

    remaining:
      Math.max(
        GUEST_DAILY_LIMIT - used,
        0
      ),

    allowed:
      used <
      GUEST_DAILY_LIMIT,
  };
}

/* =========================================================
   Consume Usage
========================================================= */

export async function consumeAnalysisUsage(): Promise<{
  type: "guest" | "subscriber";
  userId: string | null;
  guestId: string | null;
}> {
  const userId =
    await getCurrentUserId();

  /* =======================================================
     Subscriber
  ======================================================= */

  if (userId) {
    const { data: subscription } =
      await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt(
          "end_date",
          new Date().toISOString()
        )
        .order("end_date", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    /*
     * لو الاشتراك انتهى أثناء الطلب
     * نعتبره Guest.
     */
    if (!subscription) {
      const guestId =
        await ensureGuestId();

      const { error } =
        await supabaseAdmin
          .from("usage")
          .insert({
            guest_id: guestId,
            user_id: null,
            action: "analysis",
          });

      if (error) {
        console.error(
          "[Usage] Guest usage insert error:",
          error
        );

        throw new Error(
          "تعذر تسجيل استخدام التحليل"
        );
      }

      return {
        type: "guest",
        userId: null,
        guestId,
      };
    }

    const { error } =
      await supabaseAdmin
        .from("usage")
        .insert({
          user_id: userId,
          guest_id: null,
          action: "analysis",
        });

    if (error) {
      console.error(
        "[Usage] Subscriber usage insert error:",
        error
      );

      throw new Error(
        "تعذر تسجيل استخدام التحليل"
      );
    }

    return {
      type: "subscriber",
      userId,
      guestId: null,
    };
  }

  /* =======================================================
     Guest
  ======================================================= */

  const guestId =
    await ensureGuestId();

  const { error } =
    await supabaseAdmin
      .from("usage")
      .insert({
        user_id: null,
        guest_id: guestId,
        action: "analysis",
      });

  if (error) {
    console.error(
      "[Usage] Guest usage insert error:",
      error
    );

    throw new Error(
      "تعذر تسجيل استخدام التحليل"
    );
  }

  return {
    type: "guest",
    userId: null,
    guestId,
  };
}