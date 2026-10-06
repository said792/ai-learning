// app/api/admin/plans/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/* =====================================================
   التأكد إن المستخدم أدمن
===================================================== */
async function isAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ai_learning_session")?.value;

    if (!token) return false;

    const tokenHash = hashSessionToken(token);

    const { data: session } = await supabaseAdmin
      .from("auth_sessions")
      .select("users (role)")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    const user = Array.isArray(session?.users)
      ? session.users[0]
      : session?.users;

    return user?.role === "admin";
  } catch {
    return false;
  }
}

/* =====================================================
   GET: جلب كل الخطط
===================================================== */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { data: plans, error } = await supabaseAdmin
      .from("plans")
      .select("*")
      .order("price", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ plans });
  } catch (error) {
    console.error("Get plans error:", error);
    return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}

/* =====================================================
   POST: إضافة خطة جديدة
===================================================== */
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();

    const { name, description, monthly_limit, daily_limit, price, duration_days, features } = body;

    if (!name) {
      return NextResponse.json({ error: "اسم الخطة مطلوب" }, { status: 400 });
    }

    if (price == null || duration_days == null) {
      return NextResponse.json({ error: "السعر ومدة الباقة مطلوبين" }, { status: 400 });
    }

    const { data: plan, error } = await supabaseAdmin
      .from("plans")
      .insert({
        name,
        description: description || null,
        monthly_limit: monthly_limit ?? null,
        daily_limit: daily_limit ?? null,
        price: Number(price),
        duration_days: Number(duration_days),
        features: features || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    console.error("Create plan error:", error);
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
  }
}

/* =====================================================
   PUT: تعديل خطة
===================================================== */
export async function PUT(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, name, description, monthly_limit, daily_limit, price, duration_days, features } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف الخطة مطلوب" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (monthly_limit !== undefined) updateData.monthly_limit = monthly_limit;
    if (daily_limit !== undefined) updateData.daily_limit = daily_limit;
    if (price !== undefined) updateData.price = Number(price);
    if (duration_days !== undefined) updateData.duration_days = Number(duration_days);
    if (features !== undefined) updateData.features = features;

    const { data: plan, error } = await supabaseAdmin
      .from("plans")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    if (!plan) {
      return NextResponse.json({ error: "الخطة غير موجودة" }, { status: 404 });
    }

    return NextResponse.json({ plan });
  } catch (error) {
    console.error("Update plan error:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

/* =====================================================
   DELETE: حذف خطة
===================================================== */
export async function DELETE(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "معرف الخطة مطلوب" }, { status: 400 });
    }

    // نتأكد إن مفيش اشتراكات active على الخطة دي
    const { data: activeSubs } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("plan_id", id)
      .eq("status", "active");

    if (activeSubs && activeSubs.length > 0) {
      return NextResponse.json(
        { error: "لا يمكن حذف خطة لديها اشتراكات نشطة" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("plans")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete plan error:", error);
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}