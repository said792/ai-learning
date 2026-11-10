import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

/* =========================================================
   تعقيم مدخل تسجيل الدخول
   (كان يُدمج مباشرة في فلتر PostgREST — قابل لكسر/حقن الاستعلام)
========================================================= */

function sanitizeLogin(raw: string): string {
  return raw
    .trim()
    // إزالة الرموز التي تكسر صيغة فلتر PostgREST
    .replace(/[,()":*.\s]/g, "")
    .slice(0, 120);
}

/* عزل البيانات: لا نقل لملفات الزائر إلى الحساب عند الدخول —
   كل حساب يرى ملفاته فقط، وكوكي الزائر يتمسح بعد الدخول */

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const login = sanitizeLogin(String(body.login || ""));
    const password = String(body.password || "");

    if (!login || !password) {
      return NextResponse.json(
        { error: "أدخل بيانات تسجيل الدخول" },
        { status: 400 }
      );
    }

    /* استعلامات منفصلة آمنة بدل دمج الإدخال في فلتر .or() */
    const columns = `
        id,
        full_name,
        username,
        phone,
        national_id,
        email,
        password_hash,
        role,
        is_active,
        subscriptions (
          id,
          start_date,
          end_date,
          status,
          plans (
            id,
            name,
            price,
            monthly_limit,
            daily_limit,
            duration_days
          )
        )
        `;

    const [byUsername, byPhone, byNationalId, byEmail] = await Promise.all([
      supabaseAdmin.from("users").select(columns).eq("username", login).limit(1),
      supabaseAdmin.from("users").select(columns).eq("phone", login).limit(1),
      supabaseAdmin.from("users").select(columns).eq("national_id", login).limit(1),
      supabaseAdmin
        .from("users")
        .select(columns)
        .eq("email", login.toLowerCase())
        .limit(1),
    ]);

    const foundRows = [
      byUsername.data,
      byPhone.data,
      byNationalId.data,
      byEmail.data,
    ].find((rows) => rows && rows.length > 0);

    const queryError = byUsername.error; // للتوافق مع معالجة الخطأ أدناه

    const user = foundRows?.[0];

    if (queryError) {
      console.error("Login query error:", queryError);

      return NextResponse.json(
        { error: "حدث خطأ أثناء تسجيل الدخول" },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "بيانات تسجيل الدخول غير صحيحة" },
        { status: 401 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { error: "هذا الحساب غير مفعل" },
        { status: 403 }
      );
    }

    const validPassword = verifyPassword(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return NextResponse.json(
        { error: "بيانات تسجيل الدخول غير صحيحة" },
        { status: 401 }
      );
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: sessionError } = await supabaseAdmin
      .from("auth_sessions")
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

    if (sessionError) {
      console.error("Session error:", sessionError);

      return NextResponse.json(
        { error: "فشل إنشاء جلسة الدخول" },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("users")
      .update({
        last_login_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    /* =========================================================
       (تم إلغاء ربط مستندات الزائر بالحساب — عزل كامل للبيانات)
    ========================================================= */

    // ============================================
    // استخراج الاشتراك والخطة الفعالة
    // ============================================
    let subscription = null;
    let plan = null;

    const subs = user.subscriptions;

    if (Array.isArray(subs) && subs.length > 0) {
      const activeSub = subs.find(
        (s) =>
          s.status === "active" &&
          new Date(s.end_date) >= new Date()
      );

      if (activeSub) {
        subscription = {
          id: activeSub.id,
          startDate: activeSub.start_date,
          endDate: activeSub.end_date,
          status: activeSub.status,
        };

        const planData = Array.isArray(activeSub.plans)
          ? activeSub.plans[0]
          : activeSub.plans;

        if (planData) {
          plan = {
            id: planData.id,
            name: planData.name,
            price: planData.price,
            monthlyLimit: planData.monthly_limit,
            dailyLimit: planData.daily_limit,
            durationDays: planData.duration_days,
          };
        }
      }
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        phone: user.phone,
        nationalId: user.national_id,
        email: user.email,
        role: user.role,
      },
      subscription,
      plan,
    });

    response.cookies.set({
      name: "ai_learning_session",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    /* امسح كوكي الزائر بعد الربط (كلا الاسمين للتوافق مع المتصفحات القديمة) */
    response.cookies.set({
      name: "ai_guest_id",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    response.cookies.set({
      name: "guest_id",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Login API error:", error);

    return NextResponse.json(
      { error: "حدث خطأ غير متوقع" },
      { status: 500 }
    );
  }
}