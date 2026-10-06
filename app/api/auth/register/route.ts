import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

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
    // تفعيل الخطة المجانية تلقائياً
    // ============================================
    try {
      const { data: freePlan } = await supabaseAdmin
        .from("plans")
        .select("id, duration_days")
        .eq("price", 0)
        .limit(1)
        .maybeSingle();

      if (freePlan) {
        const startDate = new Date().toISOString();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + (freePlan.duration_days || 30));

        await supabaseAdmin.from("subscriptions").insert({
          user_id: user.id,
          plan_id: freePlan.id,
          start_date: startDate,
          end_date: endDate.toISOString(),
          status: "active",
        });
      }
    } catch (subError) {
      // لو فشل تفعيل الخطة ما نوقفش التسجيل
      console.error("Failed to activate free plan:", subError);
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Register API error:", error);

    return NextResponse.json(
      { error: "حدث خطأ غير متوقع" },
      { status: 500 }
    );
  }
}