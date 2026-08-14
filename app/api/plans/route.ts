import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data: plans, error } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("price", { ascending: true });

    if (error) {
      console.error("[Plans] Fetch error:", error);
      return NextResponse.json(
        { error: "حدث خطأ أثناء تحميل الباقات" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      plans: plans || [],
    });
  } catch (error) {
    console.error("[Plans] API error:", error);
    return NextResponse.json(
      { error: "حدث خطأ غير معروف" },
      { status: 500 }
    );
  }
}