import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getCurrentUserId,
  checkQuota,
  recordUsage,
  ensureGuestId,
} from "@/lib/usage";
import { buildLessonScript } from "@/lib/ai/lesson";
import {
  AllKeysExhaustedError,
  friendlyGeminiError,
  isRateLimitError,
  type GeminiTier,
} from "@/lib/ai/gemini";
import {
  generateAudioLesson,
  generateSlidesVideoLesson,
  generateVeoVideoLesson,
  getLessonSignedUrl,
} from "@/lib/lessons/generate";
import type { TtsOptions } from "@/lib/ai/tts";

export const runtime = "nodejs";
export const maxDuration = 600;

/* =========================================================
   GET /api/lessons — قائمة دروس المستخدم
   POST /api/lessons — إنشاء درس جديد (صوت / فيديو)
========================================================= */

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const userId = await getCurrentUserId();
    const guestId = cookieStore.get("ai_guest_id")?.value || null;

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "سجل الدخول أو استخدم التطبيق كزائر أولاً" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const documentId = url.searchParams.get("documentId");
    const categoryId = url.searchParams.get("categoryId");

    let query = supabaseAdmin
      .from("lessons")
      .select(
        "id, document_id, kind, mode, title, storage_path, mime_type, duration_sec, status, error_message, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (userId) {
      query = query.eq("user_id", userId);
    } else if (guestId) {
      query = query.eq("guest_id", guestId).is("user_id", null);
    }

    if (documentId) {
      query = query.eq("document_id", documentId);
    }

    /* فلتر الفولدر: دروس كل مستندات هذا الفولدر */
    if (categoryId) {
      let docQuery = supabaseAdmin
        .from("documents")
        .select("id")
        .eq("category_id", categoryId);

      if (userId) {
        docQuery = docQuery.eq("user_id", userId);
      } else if (guestId) {
        docQuery = docQuery.eq("guest_id", guestId).is("user_id", null);
      }

      const { data: catDocs } = await docQuery;
      const docIds = (catDocs || []).map((d) => d.id as string);

      if (docIds.length === 0) {
        return NextResponse.json({ success: true, lessons: [] });
      }

      query = query.in("document_id", docIds);
    }

    const { data: lessons, error } = await query;

    if (error) {
      console.error("[Lessons] List error:", error);
      return NextResponse.json(
        { success: false, error: "حدث خطأ أثناء تحميل الدروس" },
        { status: 500 }
      );
    }

    /* إثراء الدروس بمعرفة الملف والفولدر التابعين لهما */
    const docIds = [
      ...new Set(
        (lessons || [])
          .map((l) => l.document_id as string | null)
          .filter(Boolean) as string[]
      ),
    ];

    const docInfo: Record<
      string,
      { fileName: string; categoryId: string | null; categoryName: string | null }
    > = {};

    if (docIds.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("id, file_name, category_id")
        .in("id", docIds);

      const catIds = [
        ...new Set(
          (docs || [])
            .map((d) => d.category_id as string | null)
            .filter(Boolean) as string[]
        ),
      ];

      let catMap: Record<string, string> = {};

      if (catIds.length > 0) {
        const { data: cats } = await supabaseAdmin
          .from("categories")
          .select("id, name")
          .in("id", catIds);

        catMap = Object.fromEntries(
          (cats || []).map((c) => [c.id as string, c.name as string])
        );
      }

      for (const d of docs || []) {
        docInfo[d.id as string] = {
          fileName: (d.file_name as string) || "",
          categoryId: (d.category_id as string | null) || null,
          categoryName: d.category_id
            ? catMap[d.category_id as string] || null
            : null,
        };
      }
    }

    // روابط موقعة للدروس الجاهزة
    const withUrls = await Promise.all(
      (lessons || []).map(async (lesson) => {
        const url =
          lesson.status === "completed" && lesson.storage_path
            ? await getLessonSignedUrl(lesson.storage_path)
            : null;

        const info = lesson.document_id
          ? docInfo[lesson.document_id as string]
          : undefined;

        return {
          id: lesson.id,
          documentId: lesson.document_id,
          documentTitle: info?.fileName ?? null,
          categoryId: info?.categoryId ?? null,
          categoryName: info?.categoryName ?? null,
          kind: lesson.kind,
          mode: lesson.mode,
          title: lesson.title,
          mimeType: lesson.mime_type,
          durationSec: lesson.duration_sec,
          status: lesson.status,
          errorMessage: lesson.error_message,
          createdAt: lesson.created_at,
          url,
        };
      })
    );

    return NextResponse.json({ success: true, lessons: withUrls });
  } catch (error) {
    console.error("[Lessons] GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}

type CreateLessonBody = {
  documentId?: string;
  kind?: "audio" | "video";
  style?: "narration" | "podcast";
  voice?: string;
  videoMode?: "slides" | "veo";
  lang?: "ar" | "en";
  dialect?: "egyptian" | "msa";
};

export async function POST(request: Request) {
  let lessonId: string | null = null;

  try {
    const cookieStore = await cookies();
    const userId = await getCurrentUserId();

    // الدروس للمستخدمين المسجلين فقط (حماية للكوتة)
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          authRequired: true,
          error:
            "الدروس الصوتية والمرئية متاحة للمستخدمين المسجلين. سجل الدخول أو اشترك لتجربتها.",
        },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => null)) as CreateLessonBody | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "بيانات الطلب غير صالحة" },
        { status: 400 }
      );
    }

    const kind = body.kind === "video" ? "video" : "audio";
    const style = body.style === "podcast" ? "podcast" : "narration";
    const videoMode = body.videoMode === "veo" ? "veo" : "slides";
    const lang = body.lang === "en" ? "en" : "ar";

    if (!body.documentId) {
      return NextResponse.json(
        { success: false, error: "documentId مطلوب" },
        { status: 400 }
      );
    }

    // ===== الكوتة =====
    const action = kind === "audio" ? "tts_lesson" : "video_lesson";
    const quota = await checkQuota(action, { userId, guestId: null });

    if (!quota.allowed) {
      const lessonKindName =
        kind === "audio" ? "الصوتية" : "المرئية";

      const freeBlocked = quota.limit === 0 && quota.price === 0;

      return NextResponse.json(
        {
          success: false,
          limitReached: true,
          upgradeRequired: freeBlocked,
          error:
            freeBlocked
              ? `توليد الدروس ${lessonKindName} غير متاح في الباقة المجانية — متاح للباقات المدفوعة فقط. اشترك في باقة من الباقات تحت 👇 أو من صفحة الاشتراكات.`
              : quota.limit === 0
              ? `باقتك الحالية (${quota.planName || "بدون باقة"}) لا تشمل الدروس ${lessonKindName}. قم بترقية باقتك للمميزات الكاملة.`
              : `لقد وصلت إلى الحد اليومي (${quota.limit}) للدروس ${lessonKindName} في باقة "${quota.planName}". حاول غداً أو رقّ باقتك.`,
        },
        { status: 403 }
      );
    }

    /* برج المفاتيح حسب الخطة:
       الباقة المدفوعة → مفاتيح الفاتورة (برج المدفوعين) + ملجأ مجاني
       لو مفيش مفاتيح مدفوعة متسجلة في .env.local → تشغيل عادي على البرج المجاني */
    const tier: GeminiTier =
      quota.price && Number(quota.price) > 0 ? "paid" : "free";

    // ===== المستند =====
    const { data: document, error: docError } = await supabaseAdmin
      .from("documents")
      .select("id, file_name, extracted_text, analysis")
      .eq("id", body.documentId)
      .eq("user_id", userId)
      .eq("status", "completed")
      .maybeSingle();

    if (docError || !document) {
      return NextResponse.json(
        { success: false, error: "المستند غير موجود أو غير مكتمل التحليل" },
        { status: 404 }
      );
    }

    const extractedText = (document.extracted_text as string) || "";

    if (!extractedText.trim()) {
      return NextResponse.json(
        { success: false, error: "المستند لا يحتوي نصًا كافيًا لإنشاء درس" },
        { status: 422 }
      );
    }

    // ===== سجل الدرس =====
    const mode =
      kind === "audio" ? style : videoMode === "veo" ? "veo" : "slides";

    const { data: lesson, error: lessonError } = await supabaseAdmin
      .from("lessons")
      .insert({
        document_id: document.id,
        user_id: userId,
        guest_id: null,
        kind,
        mode,
        title: "جاري التحضير...",
        status: "processing",
      })
      .select("id")
      .single();

    if (lessonError || !lesson) {
      throw new Error(`فشل إنشاء سجل الدرس: ${lessonError?.message}`);
    }

    lessonId = lesson.id as string;

    // ===== إعداد إعدادات الصوت =====
    const tts: TtsOptions =
      style === "podcast"
        ? {
            speakers: [
              { speaker: "مقدم", voiceName: "Puck" },
              { speaker: "خبير", voiceName: "Kore" },
            ],
          }
        : { voiceName: body.voice || "Kore" };

    // ===== سكريبت الدرس =====
    const analysis = document.analysis as
      | { title?: string; summary?: string }
      | null;

    const script = await buildLessonScript({
      documentText: extractedText,
      analysisTitle: analysis?.title,
      analysisSummary: analysis?.summary,
      lang,
      style,
      dialect: body.dialect === "msa" ? "msa" : "egyptian",
      tier,
    });

    await supabaseAdmin
      .from("lessons")
      .update({ title: script.title, script: { sections: script.sections } })
      .eq("id", lessonId);

    // ===== التوليد =====
    let result;

    if (kind === "audio") {
      result = await generateAudioLesson({
        lessonId,
        script,
        ownerId: userId,
        tts,
        tier,
      });
    } else if (videoMode === "veo") {
      result = await generateVeoVideoLesson({
        lessonId,
        script,
        ownerId: userId,
        lang,
        tier,
      });
    } else {
      result = await generateSlidesVideoLesson({
        lessonId,
        script,
        ownerId: userId,
        tts,
        tier,
      });
    }

    await supabaseAdmin
      .from("lessons")
      .update({
        status: "completed",
        storage_path: result.storagePath,
        mime_type: result.mimeType,
        duration_sec: Math.round(result.durationSec),
      })
      .eq("id", lessonId);

    // تسجيل الاستخدام
    await recordUsage(action, { userId, guestId: null });

    const url = await getLessonSignedUrl(result.storagePath);

    return NextResponse.json({
      success: true,
      lessonId,
      kind,
      mode,
      title: script.title,
      mimeType: result.mimeType,
      durationSec: Math.round(result.durationSec),
      url,
      message:
        kind === "audio"
          ? "تم إنشاء الدرس الصوتي بنجاح 🎧"
          : "تم إنشاء فيديو الدرس بنجاح 🎬",
    });
  } catch (error) {
    console.error("[Lessons] POST error:", error);

    if (lessonId) {
      try {
        await supabaseAdmin
          .from("lessons")
          .update({
            status: "failed",
            error_message:
              error instanceof Error ? error.message : "حدث خطأ غير معروف",
          })
          .eq("id", lessonId);
      } catch {
        /* تجاهل */
      }
    }

    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف";

    /* رسالة واضحة حسب نوع الفشل بدل رسالة تقنية خام */
    let finalMessage = message;

    if (error instanceof AllKeysExhaustedError) {
      finalMessage = friendlyGeminiError(error.kind);
    } else if (isRateLimitError(message)) {
      finalMessage = friendlyGeminiError("rate_limit");
    }

    return NextResponse.json(
      {
        success: false,
        error: finalMessage,
        /* الرسالة التقنية للتشخيص فقط (مش بنعرضها للمستخدم) */
        detail: message,
      },
      { status: 500 }
    );
  }
}
