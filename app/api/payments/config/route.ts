import { NextResponse } from "next/server";
import { getSetting } from "@/lib/subscription";

export const runtime = "nodejs";

/* =========================================================
   GET /api/payments/config — إعدادات الدفع العامة
   (طرق الدفع المعروضة للمستخدم — المحافظ وأرقامها)
========================================================= */

export async function GET() {
  try {
    const methods = await getSetting("payment_methods");

    return NextResponse.json({
      success: true,
      paymentMethods: methods || "",
    });
  } catch (error) {
    console.error("[Payments Config] error:", error);
    return NextResponse.json({
      success: true,
      paymentMethods: "",
    });
  }
}
