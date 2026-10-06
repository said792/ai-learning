import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get("ai_learning_session")?.value;

    if (!token) {
      return NextResponse.json({
        user: null,
        subscription: null,
        plan: null,
      });
    }

    const tokenHash = hashSessionToken(token);

    const { data: session, error } = await supabaseAdmin
      .from("auth_sessions")
      .select(
        `
        id,
        expires_at,
        users (
          id,
          full_name,
          username,
          phone,
          national_id,
          email,
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
        )
        `
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !session) {
      return NextResponse.json({
        user: null,
        subscription: null,
        plan: null,
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from("auth_sessions")
        .delete()
        .eq("id", session.id);

      return NextResponse.json({
        user: null,
        subscription: null,
        plan: null,
      });
    }

    const user = Array.isArray(session.users)
      ? session.users[0]
      : session.users;

    if (!user || !user.is_active) {
      return NextResponse.json({
        user: null,
        subscription: null,
        plan: null,
      });
    }

    // ============================================
    // استخراج الاشتراك والخطة الفعالة
    // ============================================
    let subscription = null;
    let plan = null;

    const subs = user.subscriptions;

    if (Array.isArray(subs) && subs.length > 0) {
      // نبحث عن اشتراك active ومش منتهي الصلاحية
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

    return NextResponse.json({
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
  } catch (error) {
    console.error("Me API error:", error);

    return NextResponse.json({
      user: null,
      subscription: null,
      plan: null,
    });
  }
}