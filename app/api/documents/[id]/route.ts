import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserId, readGuestIdFromRequest } from "@/lib/usage";

export const runtime = "nodejs";

/* =========================================================
   مستند مفرد: GET / PATCH (نقل بين التصنيفات) / DELETE
========================================================= */

async function getUserOrGuest() {
  const userId = await getCurrentUserId();

  if (userId) {
    return { userId, guestId: null };
  }

  const cookieStore = await cookies();
  const guestId =
    cookieStore.get("ai_guest_id")?.value || null;

  return { userId: null, guestId };
}

/* =========================================================
   GET: تفاصيل المستند
========================================================= */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "معرف المستند غير صالح" },
        { status: 400 }
      );
    }

    const { userId, guestId } = await getUserOrGuest();

    if (!userId && !guestId) {
      return NextResponse.json(
        {
          success: false,
          authenticated: false,
          error: "سجل الدخول أو استخدم التطبيق كزائر أولاً",
        },
        { status: 401 }
      );
    }

    let query = supabaseAdmin
      .from("documents")
      .select(`
        id,
        file_name,
        file_type,
        media_type,
        file_size,
        extracted_text,
        analysis,
        status,
        category_id,
        created_at
      `)
      .eq("id", id)
      .eq("status", "completed");

    if (userId) {
      query = query.eq("user_id", userId);
    } else if (guestId) {
      query = query.eq("guest_id", guestId).is("user_id", null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[Document Details] Fetch error:", error);
      return NextResponse.json(
        { success: false, error: "حدث خطأ أثناء تحميل المستند" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: "المستند غير موجود" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      document: data,
    });
  } catch (error) {
    console.error("[Document Details] API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}

/* =========================================================
   PATCH: نقل المستند إلى تصنيف آخر
   Body: { category_id: string | null }
========================================================= */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "معرف المستند غير صالح" },
        { status: 400 }
      );
    }

    const { userId, guestId } = await getUserOrGuest();

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "سجل الدخول أولاً" },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "بيانات غير صالحة" },
        { status: 400 }
      );
    }

    /* نقبل الصيغتين: category_id (snake_case) و categoryId (camelCase)
       — سبب رئيسي لفشل النقل بين الفولدرات سابقًا */
    const rawCategory =
      "category_id" in body
        ? body.category_id
        : "categoryId" in body
        ? body.categoryId
        : undefined;

    const categoryId =
      rawCategory === undefined
        ? undefined
        : rawCategory === null || rawCategory === ""
        ? null
        : String(rawCategory);

    if (categoryId === undefined) {
      return NextResponse.json(
        { success: false, error: "category_id مطلوب (null للإزالة من التصنيف)" },
        { status: 400 }
      );
    }

    // التحقق من ملكية التصنيف الجديد إن وُجد
    if (categoryId !== null) {
      let catQuery = supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", categoryId);

      if (userId) {
        catQuery = catQuery.eq("user_id", userId);
      } else if (guestId) {
        catQuery = catQuery.eq("guest_id", guestId).is("user_id", null);
      }

      const { data: category, error: catError } = await catQuery.maybeSingle();

      if (catError || !category) {
        return NextResponse.json(
          { success: false, error: "التصنيف غير موجود أو غير مملوك لك" },
          { status: 404 }
        );
      }
    }

    // التحقق من ملكية المستند
    let docQuery = supabaseAdmin
      .from("documents")
      .select("id")
      .eq("id", id);

    if (userId) {
      docQuery = docQuery.eq("user_id", userId);
    } else if (guestId) {
      docQuery = docQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: document, error: docError } = await docQuery.maybeSingle();

    if (docError) {
      console.error("[Document PATCH] Load error:", docError);
      return NextResponse.json(
        { success: false, error: "حدث خطأ أثناء جلب المستند" },
        { status: 500 }
      );
    }

    if (!document) {
      return NextResponse.json(
        { success: false, error: "المستند غير موجود" },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("documents")
      .update({ category_id: categoryId, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      console.error("[Document PATCH] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: `فشل نقل المستند: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: categoryId
        ? "تم نقل المستند إلى التصنيف بنجاح"
        : "تم إزالة المستند من التصنيف",
    });
  } catch (error) {
    console.error("[Document PATCH] API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}

/* =========================================================
   DELETE: حذف المستند نهائيًا مع كل ما يتبعه:
   الدروس الصوتية/المرئية وملفاتها + صور المستند + الملف الأصلي من التخزين
========================================================= */

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "معرف المستند غير صالح" },
        { status: 400 }
      );
    }

    const { userId, guestId } = await getUserOrGuest();

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "سجل الدخول أولاً" },
        { status: 401 }
      );
    }

    let docQuery = supabaseAdmin
      .from("documents")
      .select("id, file_name, file_path")
      .eq("id", id);

    if (userId) {
      docQuery = docQuery.eq("user_id", userId);
    } else if (guestId) {
      docQuery = docQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: document, error: docError } = await docQuery.maybeSingle();

    if (docError) {
      console.error("[Document DELETE] Load error:", docError);
      return NextResponse.json(
        { success: false, error: "حدث خطأ أثناء جلب المستند" },
        { status: 500 }
      );
    }

    if (!document) {
      return NextResponse.json(
        { success: false, error: "المستند غير موجود" },
        { status: 404 }
      );
    }

    // 1) الدروس التابعة للمستند: نجيب مسارات ملفاتها (صوت/فيديو) قبل حذف السجلات
    const { data: docLessons } = await supabaseAdmin
      .from("lessons")
      .select("id, storage_path")
      .eq("document_id", id);

    const lessonPaths = (docLessons || [])
      .map((l) => l.storage_path)
      .filter(Boolean) as string[];

    const deletedLessons = (docLessons || []).length;

    // 2) حذف ملفات الدروس من bucket lessons
    if (lessonPaths.length > 0) {
      const { error: lessonStorageError } = await supabaseAdmin.storage
        .from("lessons")
        .remove(lessonPaths);

      if (lessonStorageError) {
        console.error(
          "[Document DELETE] فشل حذف ملفات الدروس من التخزين (غير حرج):",
          lessonStorageError.message
        );
      }
    }

    // 3) حذف سجلات الدروس التابعة للمستند نهائيًا
    await supabaseAdmin.from("lessons").delete().eq("document_id", id);

    // 4) جمع صور المستند لحذفها من التخزين
    const { data: assets } = await supabaseAdmin
      .from("document_assets")
      .select("storage_path")
      .eq("document_id", id);

    // 5) حذف سجلات الصور
    await supabaseAdmin.from("document_assets").delete().eq("document_id", id);

    // 6) حذف ملفات التخزين (الأصل + الصور) من bucket documents
    const storagePaths = (assets || [])
      .map((a) => a.storage_path)
      .filter(Boolean);

    const originalPath = (document as { file_path?: string | null }).file_path;

    if (originalPath) {
      storagePaths.push(originalPath);
    }

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("documents")
        .remove(storagePaths);

      if (storageError) {
        console.error(
          "[Document DELETE] فشل حذف الملفات من التخزين (غير حرج):",
          storageError.message
        );
      }
    }

    // 5) حذف السجل
    const { error: deleteError } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[Document DELETE] Delete error:", deleteError);
      return NextResponse.json(
        { success: false, error: `فشل حذف المستند: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: deletedLessons
        ? `تم حذف المستند نهائيًا مع كل ما يتبعه (الملف الأصلي + الصور + ${deletedLessons} درس بملفاته)`
        : "تم حذف المستند نهائيًا مع كل ما يتبعه (الملف الأصلي + الصور)",
    });
  } catch (error) {
    console.error("[Document DELETE] API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}
