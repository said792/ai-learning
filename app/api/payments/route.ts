import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";
import {
  getPaymentRequestType,
  paymentsHaveRequestType,
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
   GET: سجل مدفوعاتي
========================================================= */

export async function GET() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
  }

  const { data: payments, error } = await supabaseAdmin
    .from("payments")
    .select(
      `id, amount, method, reference, status, created_at, decided_at,
       plans ( id, name, price, duration_days )`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[Payments] GET error:", error);
    return NextResponse.json(
      { error: "حدث خطأ أثناء تحميل المدفوعات" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, payments: payments || [] });
}

/* =========================================================
   POST: تسجيل طلب دفع — بعد ما المستخدم حوّل الفلوس
   - الرقم المرجعي إلزامي (الإدارة بتأكد الدفع بيه)
   - الطلب دايمًا pending — مفيش تفعيل تلقائي نهائيًا:
     * أول اشتراك (new) → الأدمن يوافق → يتولد كود تفعيل يبعته للمستخدم
     * تجديد (renewal) → الأدمن يوافق → يتجدد فورًا من يوم الدفع نفسه
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

    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { error: "بيانات الطلب غير صالحة" },
        { status: 400 }
      );
    }

    const planId = String(body.planId || "").trim();
    const method = String(body.method || "").trim();
    const reference = String(body.reference || "").trim();

    if (!planId) {
      return NextResponse.json(
        { error: "اختر الباقة أولاً" },
        { status: 400 }
      );
    }

    /* الرقم المرجعي إلزامي — من غيره الإدارة متعرفش تأكد الدفع */
    if (!reference) {
      return NextResponse.json(
        {
          error:
            "لازم تكتب رقم عملية التحويل (المرجع) — الإدارة بتأكد الدفع بالرقم ده",
        },
        { status: 400 }
      );
    }

    /* مفيش أكثر من طلب دفع معلق واحد — استنى مراجعة الإدارة الأول */
    const { data: pendingPayment } = await supabaseAdmin
      .from("payments")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingPayment) {
      return NextResponse.json(
        {
          error:
            "عندك طلب دفع قيد المراجعة بالفعل — استنى مراجعة الإدارة الأول، ولو حصلت مشكلة كلّم الإدارة",
        },
        { status: 400 }
      );
    }

    /* الباقة لازم تكون مدفوعة ومتاحة */
    const { data: plan, error: planError } = await supabaseAdmin
      .from("plans")
      .select("id, name, price, duration_days, is_active")
      .eq("id", planId)
      .maybeSingle();

    if (planError || !plan || !plan.is_active) {
      return NextResponse.json(
        { error: "الباقة غير موجودة أو غير متاحة" },
        { status: 404 }
      );
    }

    if (Number(plan.price) === 0) {
      return NextResponse.json(
        {
          error:
            "الباقة المجانية بتفعّل تلقائياً مع أي حساب جديد — مش محتاجة دفع ولا كود",
        },
        { status: 400 }
      );
    }

    const requestType = await getPaymentRequestType(userId);
    const amount = Number(plan.price) || 0;

    /* تسجيل الطلب — pending دايمًا لحد ما الأدمن يراجع.
       لو ترقية 03 متشغلتش بعد: نسيب عمود request_type (بيتحسب وقت الموافقة) */
    const supportsRequestType = await paymentsHaveRequestType();
    const payload: Record<string, unknown> = {
      user_id: userId,
      plan_id: plan.id,
      amount,
      method: method || "غير محدد",
      reference,
      status: "pending",
    };
    if (supportsRequestType) payload.request_type = requestType;

    const { data: payment, error: payError } = await supabaseAdmin
      .from("payments")
      .insert(payload)
      .select("id")
      .single();

    if (payError || !payment) {
      console.error("[Payments] Insert error:", payError);
      return NextResponse.json(
        { error: "فشل تسجيل الدفعة — حاول تاني" },
        { status: 500 }
      );
    }

    /* رسالة حسب نوع الطلب */
    const message =
      requestType === "new"
        ? "تم استلام طلبك بنجاح ✅ — الإدارة هتراجع الدفع، وبعد التأكيد هيستلم كود التفعيل. ادخل الكود في صفحة الباقات واشتراكك هيبدأ من يوم ما حولت الفلوس نفسه."
        : "تم استلام طلب التجديد ✅ — أول ما الإدارة تأكد الدفع هيتم تجديد اشتراكك تلقائيًا من غير أي كود، والمدة بتتحسب من يوم ما حولت الفلوس نفسه.";

    return NextResponse.json({
      success: true,
      requestType,
      message,
    });
  } catch (error) {
    console.error("[Payments] POST error:", error);
    return NextResponse.json({ error: "حدث خطأ غير معروف" }, { status: 500 });
  }
}
