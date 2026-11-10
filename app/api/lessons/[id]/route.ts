import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserId } from "@/lib/usage";
import { getLessonSignedUrl } from "@/lib/lessons/generate";

export const runtime = "nodejs";

/* =========================================================
   GET /api/lessons/[id] — رابط مووقع لدرس واحد
   DELETE /api/lessons/[id] — حذف الدرس
========================================================= */

async function loadOwnedLesson(id: string) {
  const cookieStore = await cookies();
  const userId = await getCurrentUserId();
  const guestId = cookieStore.get("ai_guest_id")?.value || null;

  if (!userId && !guestId) {
    return { owner: null as null | { userId: string | null; guestId: string | null }, lesson: null };
  }

  let query = supabaseAdmin
    .from("lessons")
    .select("id, storage_path, status")
    .eq("id", id);

  if (userId) {
    query = query.eq("user_id", userId);
  } else if (guestId) {
    query = query.eq("guest_id", guestId).is("user_id", null);
  }

  const { data: lesson } = await query.maybeSingle();

  return { owner: { userId, guestId }, lesson };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { lesson } = await loadOwnedLesson(id);

    if (!lesson) {
      return NextResponse.json(
        { success: false, error: "الدرس غير موجود" },
        { status: 404 }
      );
    }

    const url =
      lesson.status === "completed" && lesson.storage_path
        ? await getLessonSignedUrl(lesson.storage_path)
        : null;

    return NextResponse.json({
      success: true,
      lesson: { id: lesson.id, status: lesson.status, url },
    });
  } catch (error) {
    console.error("[Lessons] GET by id error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { lesson } = await loadOwnedLesson(id);

    if (!lesson) {
      return NextResponse.json(
        { success: false, error: "الدرس غير موجود" },
        { status: 404 }
      );
    }

    // حذف من التخزين
    if (lesson.storage_path) {
      await supabaseAdmin.storage
        .from("lessons")
        .remove([lesson.storage_path])
        .catch(() => undefined);
    }

    // حذف السجل
    const { error } = await supabaseAdmin
      .from("lessons")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { success: false, error: `فشل حذف الدرس: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "تم حذف الدرس بنجاح",
    });
  } catch (error) {
    console.error("[Lessons] DELETE error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}
