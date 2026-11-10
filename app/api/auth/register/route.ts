import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
} from "@/lib/auth";
import { ensureFreePlan } from "@/lib/subscription";

export const runtime = "nodejs";

/* =========================================================
   عزل البيانات — قرار التصميم:
   كل حساب يبدأ فاضي تمامًا. ملفات الزائر (قبل التسجيل) لا تُنقل
   للحساب — لأن كده كان الحساب الجديد بيورّث ملفات الجلسة السابقة
   على نفس الجهاز/المتصفح. كل مستخدم ليه ملفاته فقط.
   (كوكي الزائر يتمسح بعد التسجيل/الدخول — انظر نهاية الملف)
========================================================= */

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const fullName = String(body.fullName || "").trim();
    const username = String(body.username || "").trim();
    const phone = String(body.phone || "").trim() || null;
    const nationalId = String(body.nationalId || "").trim() || null;
    const email = String(body.email || "").trim().toLowerCase() || null;
    const password = String(body.password || "");

    if (!fullName) {
      return NextResponse.json(
        { error: "الاسم مطلوب" },
        { status: 400 }
      );
    }

    if (!username) {
      return NextResponse.json(
        { error: "اسم المستخدم مطلوب" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" },
        { status: 400 }
      );
    }

    if (!phone && !nationalId && !email) {
      return NextResponse.json(
        {
          error:
            "يجب إدخال الهاتف أو الرقم القومي أو البريد الإلكتروني",
        },
        { status: 400 }
      );
    }

    // التأكد من عدم وجود المستخدم
    const checks = [
      supabaseAdmin
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle(),
    ];

    if (phone) {
      checks.push(
        supabaseAdmin
          .from("users")
          .select("id")
          .eq("phone", phone)
          .maybeSingle()
      );
    }

    if (nationalId) {
      checks.push(
        supabaseAdmin
          .from("users")
          .select("id")
          .eq("national_id", nationalId)
          .maybeSingle()
      );
    }

    if (email) {
      checks.push(
        supabaseAdmin
          .from("users")
          .select("id")
          .eq("email", email)
          .maybeSingle()
      );
    }

    const results = await Promise.all(checks);

    if (results.some((result) => result.error)) {
      console.error(results);
      return NextResponse.json(
        { error: "حدث خطأ أثناء فحص بيانات المستخدم" },
        { status: 500 }
      );
    }

    if (results.some((result) => result.data)) {
      return NextResponse.json(
        {
          error:
            "اسم المستخدم أو الهاتف أو الرقم القومي أو البريد مستخدم بالفعل",
        },
        { status: 409 }
      );
    }

    const passwordHash = hashPassword(password);

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .insert({
        full_name: fullName,
        username,
        phone,
        national_id: nationalId,
        email,
        password_hash: passwordHash,
        role: "user",
        is_active: true,
      })
      .select(
        "id, full_name, username, phone, national_id, email, role, is_active"
      )
      .single();

    if (error) {
      console.error("Register error:", error);

      return NextResponse.json(
        { error: "فشل إنشاء الحساب" },
        { status: 500 }
      );
    }

    // ============================================
    // تفعيل الخطة المجانية تلقائياً — مدى الحياة بدون أي كود
    // (لو الخطة المجانية مش موجودة في قاعدة البيانات نعملها أولًا)
    // ============================================
    try {
      const freePlan = await ensureFreePlan();

      const startDate = new Date().toISOString();
      const endDate = new Date();
      endDate.setDate(
        endDate.getDate() + Math.max(Number(freePlan.duration_days) || 36500, 30)
      );

      await supabaseAdmin.from("subscriptions").insert({
        user_id: user.id,
        plan_id: freePlan.id,
        start_date: startDate,
        end_date: endDate.toISOString(),
        status: "active",
      });
    } catch (subError) {
      // لو فشل تفعيل الخطة ما نوقفش التسجيل
      console.error("Failed to activate free plan:", subError);
    }

    // ============================================
    // (تم إلغاء نقل بيانات الزائر للحساب — عزل كامل لكل مستخدم)
    // ============================================

    // ============================================
    // تسجيل دخول تلقائي — جلسة جديدة للحساب الجديد
    // (بدلها المستخدم يفضل داخل بجلسة حساب قديم
    //  ويلقى بيانات مش بتاعته)
    // ============================================
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
      console.error("[Register] Session error:", sessionError);
      // مش هنوقف التسجيل — المستخدم يقدر يسجل دخول يدويًا
    }

    await supabaseAdmin
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    const response = NextResponse.json({
      success: true,
      user,
      autoLoggedIn: !sessionError,
    });

    if (!sessionError) {
      response.cookies.set({
        name: "ai_learning_session",
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
    }

    /* امسح كوكي الزائر بعد الربط (كلا الاسمين للتوافق) */
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
    console.error("Register API error:", error);

    return NextResponse.json(
      { error: "حدث خطأ غير متوقع" },
      { status: 500 }
    );
  }
}