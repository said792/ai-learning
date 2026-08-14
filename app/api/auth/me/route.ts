import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get(
      "ai_learning_session"
    )?.value;

    if (!token) {
      return NextResponse.json({
        user: null,
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
          is_active
        )
        `
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !session) {
      return NextResponse.json({
        user: null,
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from("auth_sessions")
        .delete()
        .eq("id", session.id);

      return NextResponse.json({
        user: null,
      });
    }

    const user = Array.isArray(session.users)
      ? session.users[0]
      : session.users;

    if (!user || !user.is_active) {
      return NextResponse.json({
        user: null,
      });
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
    });
  } catch (error) {
    console.error("Me API error:", error);

    return NextResponse.json({
      user: null,
    });
  }
}