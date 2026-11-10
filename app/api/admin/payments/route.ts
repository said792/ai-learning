import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";
import {
  activatePlanForUser,
  activationMessage,
  generateActivationCode,
  getPaymentRequestType,
  getSetting,
  paymentsHaveRequestType,
  setSetting,
  type PlanRecord,
} from "@/lib/subscription";

export const runtime = "nodejs";

async function getAdminUser() {
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
    .select("id, role, is_active")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || !user.is_active || user.role !== "admin") return null;
  return user;
}

/* =========================================================
   GET: كل الدفعات + إعدادات الدفع + إحصائيات التكلفة
========================================================= */

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";

  /* لو ترقية 03 متشغلتش بعد — نطلب من غير عمود request_type */
  const supportsRequestType = await paymentsHaveRequestType();
  const selectFields: string = supportsRequestType
    ? "id, amount, method, reference, status, created_at, decided_at, plan_id, user_id, request_type, plans ( id, name, price, duration_days ), users:user_id ( id, full_name, username, phone, email )"
    : "id, amount, method, reference, status, created_at, decided_at, plan_id, user_id, plans ( id, name, price, duration_days ), users:user_id ( id, full_name, username, phone, email )";

  let query = supabaseAdmin
    .from("payments")
    .select(selectFields)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("status", status);
  }

  const { data: payments, error } = await query;

  if (error) {
    console.error("[Admin Payments] Fetch error:", error);
    return NextResponse.json(
      { error: "حدث خطأ أثناء تحميل الدفعات" },
      { status: 500 }
    );
  }

  /* إعدادات الدفع — طرق الدفع بس (الموافقة التلقائية أتلغت نهائيًا) */
  const methods = await getSetting("payment_methods");

  /* إحصائيات التكلفة — إجمالي المقبوضات + عدد الدروس المولدة */
  const { data: revenueRows } = await supabaseAdmin
    .from("payments")
    .select("amount")
    .eq("status", "approved");

  const revenue = (revenueRows || []).reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0
  );

  const { count: ttsTotal } = await supabaseAdmin
    .from("usage")
    .select("id", { count: "exact", head: true })
    .eq("action", "tts_lesson");

  const { count: videoTotal } = await supabaseAdmin
    .from("usage")
    .select("id", { count: "exact", head: true })
    .eq("action", "video_lesson");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { count: ttsToday } = await supabaseAdmin
    .from("usage")
    .select("id", { count: "exact", head: true })
    .eq("action", "tts_lesson")
    .gte("created_at", startOfToday.toISOString());

  const { count: videoToday } = await supabaseAdmin
    .from("usage")
    .select("id", { count: "exact", head: true })
    .eq("action", "video_lesson")
    .gte("created_at", startOfToday.toISOString());

  return NextResponse.json({
    success: true,
    payments: payments || [],
    settings: {
      paymentMethods: methods || "",
    },
    stats: {
      revenue,
      ttsTotal: ttsTotal ?? 0,
      videoTotal: videoTotal ?? 0,
      ttsToday: ttsToday ?? 0,
      videoToday: videoToday ?? 0,
    },
  });
}

/* =========================================================
   POST: موافقة / رفض دفعة
   - أول اشتراك (new): الموافقة بتولّد كود تفعيل مربوط بالمستخدم
     (مش بيشتغل مع حد تاني) وبيحمل يوم بداية الاشتراك = يوم الدفع —
     الأدمن ينسخ الكود ويبعته للمستخدم يدخله في صفحة الباقات
   - تجديد (renewal): الموافقة بتجدد الاشتراك فورًا من غير أي كود،
     والمدة بتتحسب من يوم ما المستخدم أكد الدفع مش من يوم الموافقة
========================================================= */

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  /* لو ترقية 03 متشغلتش بعد — نطلب من غير عمود request_type */
  const supportsRequestType = await paymentsHaveRequestType();

  try {
    const body = await req.json();
    const paymentId = String(body.paymentId || "").trim();
    const decision = String(body.decision || "").trim();

    if (!paymentId || !["approved", "rejected"].includes(decision)) {
      return NextResponse.json(
        { error: "بيانات القرار غير صالحة" },
        { status: 400 }
      );
    }

    const paymentSelect: string = supportsRequestType
      ? "id, user_id, plan_id, status, request_type, created_at, users:user_id ( id, full_name, username, phone, email )"
      : "id, user_id, plan_id, status, created_at, users:user_id ( id, full_name, username, phone, email )";

    /* select بمتغير نصي (لدعم الترقية 03 قبل/بعد التشغيل) — نعمل cast صريح */
    type PaymentRow = {
      id: string;
      user_id: string;
      plan_id: string;
      status: string;
      created_at: string;
      request_type?: "new" | "renewal";
      users: unknown;
    };

    const { data: paymentRow } = await supabaseAdmin
      .from("payments")
      .select(paymentSelect)
      .eq("id", paymentId)
      .maybeSingle();

    const payment = paymentRow as unknown as PaymentRow | null;

    if (!payment) {
      return NextResponse.json({ error: "الدفعة غير موجودة" }, { status: 404 });
    }

    if (payment.status !== "pending") {
      return NextResponse.json(
        { error: "الدفعة اتخذت قرار بشأنها بالفعل" },
        { status: 400 }
      );
    }

    const paymentUser = Array.isArray(payment.users)
      ? (payment.users as Array<Record<string, unknown>>)[0]
      : (payment.users as Record<string, unknown> | null);
    const userName =
      (paymentUser?.full_name as string | null) ||
      (paymentUser?.username as string | null) ||
      "المستخدم";

    /* نوع الطلب: المحفوظ لو الترقية متشغلة، وإلا حساب مباشر */
    const requestType: "new" | "renewal" = supportsRequestType
      ? (payment.request_type || "new")
      : await getPaymentRequestType(payment.user_id);

    if (decision === "rejected") {
      await supabaseAdmin
        .from("payments")
        .update({
          status: "rejected",
          decided_at: new Date().toISOString(),
          decided_by: admin.id,
        })
        .eq("id", paymentId);

      return NextResponse.json({
        success: true,
        message: "تم رفض الدفعة",
      });
    }

    /* ===== أول اشتراك (new) → توليد كود تفعيل مربوط بالمستخدم =====
       الاشتراك مش بيتفعل هنا — المستخدم يدخل الكود عشان يتأكد إنه استلمه،
       واشتراكه هيبدأ من يوم الدفع نفسه (anchor_date) مش من يوم إدخال الكود */
    if (requestType === "new") {
      const code = await generateActivationCode({
        planId: payment.plan_id,
        boundUserId: payment.user_id,
        paymentId: payment.id,
        anchorDate: payment.created_at,
      });

      await supabaseAdmin
        .from("payments")
        .update({
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_by: admin.id,
        })
        .eq("id", paymentId);

      return NextResponse.json({
        success: true,
        requestType: "new",
        code,
        userName,
        message: supportsRequestType
          ? `تم قبول الدفعة وإنشاء كود تفعيل لـ ${userName} — انسخ الكود وابعته له، واشتراكه هيبدأ من يوم ما دفع نفسه.`
          : `تم قبول الدفعة وإنشاء كود تفعيل لـ ${userName} — انسخ الكود وابعته له.`,
      });
    }

    /* ===== تجديد (renewal) → تفعيل فوري من يوم الدفع ===== */
    const { data: plan } = await supabaseAdmin
      .from("plans")
      .select("id, name, price, duration_days")
      .eq("id", payment.plan_id)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json(
        { error: "الباقة المرتبطة بالدفعة لم تعد متاحة" },
        { status: 404 }
      );
    }

    const result = await activatePlanForUser(payment.user_id, plan as PlanRecord, {
      anchorDate: payment.created_at,
    });

    await supabaseAdmin
      .from("payments")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: admin.id,
        subscription_id: result.subscriptionId,
      })
      .eq("id", paymentId);

    return NextResponse.json({
      success: true,
      requestType: "renewal",
      message: `تم تجديد اشتراك ${userName} — ${activationMessage(plan.name, result)}`,
    });
  } catch (error) {
    console.error("[Admin Payments] POST error:", error);
    return NextResponse.json({ error: "حدث خطأ غير معروف" }, { status: 500 });
  }
}

/* =========================================================
   PUT: حفظ إعدادات الدفع (نص طرق الدفع/المحافظ المعروض للمستخدمين)
========================================================= */

export async function PUT(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (body.paymentMethods !== undefined) {
      await setSetting("payment_methods", String(body.paymentMethods));
    }

    return NextResponse.json({ success: true, message: "تم حفظ الإعدادات" });
  } catch (error) {
    console.error("[Admin Payments] PUT error:", error);
    return NextResponse.json({ error: "حدث خطأ غير معروف" }, { status: 500 });
  }
}
