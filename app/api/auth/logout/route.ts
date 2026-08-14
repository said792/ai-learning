import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get(
      "ai_learning_session"
    )?.value;

    if (token) {
      const tokenHash = hashSessionToken(token);

      await supabaseAdmin
        .from("auth_sessions")
        .delete()
        .eq("token_hash", tokenHash);
    }

    const response = NextResponse.json({
      success: true,
    });

    response.cookies.set({
      name: "ai_learning_session",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);

    return NextResponse.json(
      { error: "حدث خطأ أثناء تسجيل الخروج" },
      { status: 500 }
    );
  }
}