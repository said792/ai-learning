import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

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
   GET: عرض الكودات
========================================================= */

export async function GET(req: Request) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "غير مصرح" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const planId = searchParams.get("planId") || "";
    const status = searchParams.get("status") || "";

    let query = supabaseAdmin
      .from("activation_codes")
      .select(
        `
        id,
        code,
        is_used,
        used_at,
        created_at,
        used_by,
        plans (
          id,
          name,
          price,
          duration_days
        ),
        users:used_by (
          id,
          full_name,
          username,
          phone,
          email
        )
        `
      )
      .order("created_at", { ascending: false });

    if (planId) {
      query = query.eq("plan_id", planId);
    }

    if (status === "used") {
      query = query.eq("is_used", true);
    } else if (status === "available") {
      query = query.eq("is_used", false);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Admin Codes] Fetch error:", error);
      return NextResponse.json(
        { error: "حدث خطأ أثناء تحميل الكودات" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      codes: data || [],
    });
  } catch (error) {
    console.error("[Admin Codes] GET error:", error);
    return NextResponse.json(
      { error: "حدث خطأ غير معروف" },
      { status: 500 }
    );
  }
}

/* =========================================================
   POST: إنشاء كودات جديدة
========================================================= */

export async function POST(req: Request) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "غير مصرح" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const planId = String(body.planId || "").trim();
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
    const prefix = String(body.prefix || "").trim().toUpperCase();

    if (!planId) {
      return NextResponse.json(
        { error: "اختر الباقة" },
        { status: 400 }
      );
    }

    /* التأكد إن الباقة موجودة */
    const { data: plan } = await supabaseAdmin
      .from("plans")
      .select("id, name")
      .eq("id", planId)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json(
        { error: "الباقة غير موجودة" },
        { status: 404 }
      );
    }

    /* توليد الكودات */
    const codes: { code: string; plan_id: string }[] = [];
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (let i = 0; i < count; i++) {
      let code = "";
      if (prefix) code = prefix + "-";

      for (let j = 0; j < 6; j++) {
        code += chars.charAt(
          Math.floor(Math.random() * chars.length)
        );
      }

      codes.push({ code, plan_id: planId });
    }

    const { error } = await supabaseAdmin
      .from("activation_codes")
      .insert(codes)
      .select("code");

    if (error) {
      /* لو كان فيه تكرار في الكودات (نادر جداً) */
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "حدث تكرار في أحد الكودات، حاول مرة أخرى",
          },
          { status: 409 }
        );
      }
      console.error(
        "[Admin Codes] Insert error:",
        error
      );
      return NextResponse.json(
        { error: "فشل إنشاء الكودات" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `تم إنشاء ${count} كود بنجاح`,
      generatedCodes: codes.map((c) => c.code),
    });
  } catch (error) {
    console.error("[Admin Codes] POST error:", error);
    return NextResponse.json(
      { error: "حدث خطأ غير معروف" },
      { status: 500 }
    );
  }
}