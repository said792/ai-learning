import { NextResponse } from "next/server";
import { analyzeDocument } from "@/lib/ai/analyzer";
import {
  getCurrentUserId,
  checkQuota,
  recordUsage,
} from "@/lib/usage";

export const runtime = "nodejs";

/* =========================================================
   إعادة تحليل نص — مؤمَّن: تسجيل دخول مطلوب + يُحسب من كوتة التحليل
   (كان مفتوحًا بالكامل وبدون كوتة سابقًا)
========================================================= */

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "يجب تسجيل الدخول لإعادة التحليل" },
        { status: 401 }
      );
    }

    const { text, lang } = await req.json().catch(() => ({ text: null }));

    if (!text || typeof text !== "string") {
      return NextResponse.json({ success: false, error: "Text is required" }, { status: 400 });
    }

    if (text.length > 200_000) {
      return NextResponse.json(
        { success: false, error: "النص طويل جدًا للإعادة التحليل" },
        { status: 413 }
      );
    }

    // الكوتة (يُحسب كتحليل مستند)
    const quota = await checkQuota("document_analysis", { userId, guestId: null });

    if (!quota.allowed) {
      return NextResponse.json(
        {
          success: false,
          limitReached: true,
          error:
            quota.type === "subscriber"
              ? `لقد وصلت إلى حد الاستخدام في باقة "${quota.planName || "الحالية"}". قم بتجديد أو ترقية باقتك.`
              : "لقد وصلت إلى الحد اليومي للاستخدام. حاول غدًا.",
        },
        { status: 403 }
      );
    }

    const selectedLang = lang === "en" ? "en" : "ar";
    const analysis = await analyzeDocument(text, selectedLang);

    await recordUsage("document_analysis", { userId, guestId: null });

    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
