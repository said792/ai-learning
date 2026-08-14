import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const login = String(body.login || "").trim();
    const password = String(body.password || "");

    if (!login || !password) {
      return NextResponse.json(
        { error: "أدخل بيانات تسجيل الدخول" },
        { status: 400 }
      );
    }

    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select(
        `
        id,
        full_name,
        username,
        phone,
        national_id,
        email,
        password_hash,
        role,
        is_active
        `
      )
      .or(
        `username.eq.${login},phone.eq.${login},national_id.eq.${login},email.eq.${login.toLowerCase()}`
      )
      .limit(1);

    if (error) {
      console.error("Login query error:", error);

      return NextResponse.json(
        { error: "حدث خطأ أثناء تسجيل الدخول" },
        { status: 500 }
      );
    }

    const user = users?.[0];

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
       ربط مستندات الزائر بالحساب الجديد
       
       1. نقرأ guest_id من الكوكيز
       2. نحدّث كل مستندات هذا الزائر → نضع لها user_id
       3. نمسح كوكيز guest_id
       
       هذا الاستعلام آمن لأنه:
       - يربط فقط مستندات ليس لها user_id
       - يربط فقط مستندات هذا guest_id بالتحديد
       - لو حصل أي خطأ، تسجيل الدخول يكمل عادي
    ========================================================= */

    try {
      const cookieStore = await cookies();
      const guestId = cookieStore.get("guest_id")?.value;

      if (guestId) {
        const { error: linkError } = await supabaseAdmin
          .from("documents")
          .update({ user_id: user.id })
          .eq("guest_id", guestId)
          .is("user_id", null);

        if (linkError) {
          console.error(
            "[Login] Failed to link guest documents:",
            linkError
          );
        }
      }
    } catch (linkError) {
      console.error(
        "[Login] Guest link error:",
        linkError
      );
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

    /* امسح كوكيز guest_id بعد الربط */
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