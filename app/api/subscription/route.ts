import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("ai_learning_session")?.value;
  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  const { data: session } = await supabaseAdmin
    .from("auth_sessions")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id, is_active")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || !user.is_active) return null;
  return user.id;
}

/* =========================================================
   GET: عرض الاشتراك الحالي
========================================================= */

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return NextResponse.json({
        subscription: null,
        plan: null,
      });
    }

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select(
        `
        id,
        start_date,
        end_date,
        status,
        plans (
          id,
          name,
          monthly_limit,
          daily_limit,
          price,
          duration_days,
          features
        )
        `
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("end_date", new Date().toISOString())
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub) {
      return NextResponse.json({
        subscription: null,
        plan: null,
      });
    }

    const plan = Array.isArray(sub.plans)
      ? sub.plans[0]
      : sub.plans;

    return NextResponse.json({
      subscription: {
        id: sub.id,
        startDate: sub.start_date,
        endDate: sub.end_date,
        status: sub.status,
      },
      plan: plan || null,
    });
  } catch (error) {
    console.error("[Subscription] GET error:", error);
    return NextResponse.json({
      subscription: null,
      plan: null,
    });
  }
}

/* =========================================================
   POST: تفعيل اشتراك بكود
========================================================= */

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return NextResponse.json(
        { error: "يجب تسجيل الدخول أولاً" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const planId = String(body.planId || "").trim();
    const code = String(body.code || "").trim().toUpperCase();

    if (!planId || !code) {
      return NextResponse.json(
        { error: "بيانات غير مكتملة" },
        { status: 400 }
      );
    }

    /* التأكد إن الباقة موجودة وفاعلة */
    const { data: plan, error: planError } =
      await supabaseAdmin
        .from("plans")
        .select("*")
        .eq("id", planId)
        .eq("is_active", true)
        .maybeSingle();

    if (planError || !plan) {
      return NextResponse.json(
        {
          error:
            "الباقة غير موجودة أو غير متاحة",
        },
        { status: 404 }
      );
    }

    /* التحقق من كود التفعيل */
    const { data: codeRecord, error: codeError } =
      await supabaseAdmin
        .from("activation_codes")
        .select("*")
        .eq("code", code)
        .eq("plan_id", planId)
        .eq("is_used", false)
        .maybeSingle();

    if (codeError || !codeRecord) {
      return NextResponse.json(
        {
          error:
            "كود التفعيل غير صالح أو مستخدم بالفعل",
        },
        { status: 400 }
      );
    }

    /* تعطيل الاشتراكات القديمة الفاعلة */
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("user_id", userId)
      .eq("status", "active");

    /* حساب تاريخ الانتهاء */
    const endDate = new Date();
    endDate.setDate(
      endDate.getDate() + plan.duration_days
    );

    /* إنشاء الاشتراك الجديد */
    const { error: subError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan_id: planId,
        start_date: new Date().toISOString(),
        end_date: endDate.toISOString(),
        status: "active",
      });

    if (subError) {
      console.error(
        "[Subscription] Create error:",
        subError
      );
      return NextResponse.json(
        { error: "فشل إنشاء الاشتراك" },
        { status: 500 }
      );
    }

    /* تحديد الكود كمستخدم */
    await supabaseAdmin
      .from("activation_codes")
      .update({
        is_used: true,
        used_by: userId,
        used_at: new Date().toISOString(),
      })
      .eq("id", codeRecord.id);

    return NextResponse.json({
      success: true,
      message: "تم تفعيل الاشتراك بنجاح",
    });
  } catch (error) {
    console.error("[Subscription] POST error:", error);
    return NextResponse.json(
      { error: "حدث خطأ غير معروف" },
      { status: 500 }
    );
  }
}