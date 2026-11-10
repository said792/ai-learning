import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";
import {
  activatePlanForUser,
  activationMessage,
  getEffectiveSubscription,
  type PlanRecord,
} from "@/lib/subscription";

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

    /* الاشتراك الفعّال: الباقة المدفوعة السارية أولًا، وإلا الخطة المجانية */
    const sub = await getEffectiveSubscription(
      userId,
      `id, start_date, end_date, status,
       plans ( id, name, monthly_limit, daily_limit, price, duration_days, features )`
    ).catch(() => null);

    if (!sub) {
      return NextResponse.json({
        subscription: null,
        plan: null,
      });
    }

    const plan = Array.isArray(sub.plans)
      ? (sub.plans as Array<Record<string, unknown>>)[0]
      : (sub.plans as Record<string, unknown> | null);

    if (!plan) {
      return NextResponse.json({
        subscription: null,
        plan: null,
      });
    }

    const daysRemaining = Math.max(
      Math.ceil(
        (new Date(sub.end_date as string).getTime() - Date.now()) /
          (24 * 60 * 60 * 1000)
      ),
      0
    );

    return NextResponse.json({
      subscription: {
        id: sub.id,
        startDate: sub.start_date,
        endDate: sub.end_date,
        status: sub.status,
        daysRemaining,
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
   POST: تفعيل / تجديد اشتراك بكود
   - الكود هو مصدر الحقيقة للباقة (بنشتغل من الكود مباشرة)
   - كود موافقة دفعة أول اشتراك بيبقى مربوط بمستخدم محدد —
     مش بيشتغل مع أي حساب تاني
   - لو الكود بيحمل يوم بداية (يوم الدفع) — المدة بتتحسب من يوم ما
     المستخدم أكد الدفع مش من يوم إدخال الكود
   - لو عنده اشتراك ساري: المدة بتتزاد على المتبقي (تجديد تراكمي)
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
    const code = String(body.code || "").trim().toUpperCase();

    if (!code) {
      return NextResponse.json(
        { error: "أدخل كود التفعيل" },
        { status: 400 }
      );
    }

    /* التحقق من كود التفعيل — من الكود نفسه بنعرف الباقة */
    const { data: codeRecord, error: codeError } =
      await supabaseAdmin
        .from("activation_codes")
        .select("*")
        .eq("code", code)
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

    /* الكود المولد بعد موافقة دفعة بيبقى مربوط بمستخدم محدد */
    if (
      codeRecord.bound_user_id &&
      codeRecord.bound_user_id !== userId
    ) {
      return NextResponse.json(
        {
          error:
            "الكود ده مخصص لمستخدم آخر — اتأكد إنك داخل بحسابك الصحيح، أو كلّم الإدارة",
        },
        { status: 403 }
      );
    }

    /* الباقة اللي تابعة لها الكود */
    const { data: plan, error: planError } =
      await supabaseAdmin
        .from("plans")
        .select("id, name, price, duration_days")
        .eq("id", codeRecord.plan_id)
        .eq("is_active", true)
        .maybeSingle();

    if (planError || !plan) {
      return NextResponse.json(
        {
          error:
            "الباقة المرتبطة بالكود غير موجودة أو غير متاحة",
        },
        { status: 404 }
      );
    }

    /* التفعيل/التجديد — المنطق الموحد (تراكمي فوق المتبقي)،
       والبداية من يوم الدفع لو الكود بيحمل يوم بداية */
    const result = await activatePlanForUser(userId, plan as PlanRecord, {
      anchorDate: codeRecord.anchor_date ?? null,
    });

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
      renewed: result.renewed,
      planName: plan.name,
      endDate: result.endDate,
      daysAdded: result.daysAdded,
      daysRemaining: result.daysRemaining,
      message: activationMessage(plan.name, result),
    });
  } catch (error) {
    console.error("[Subscription] POST error:", error);
    return NextResponse.json(
      { error: "حدث خطأ غير معروف" },
      { status: 500 }
    );
  }
}