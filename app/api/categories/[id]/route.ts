import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* =========================================================
   Cookie Helpers (same as categories/route.ts)
========================================================= */

const AUTH_COOKIE_NAMES = [
  "ai_learning_session",
  "auth_token",
  "session_token",
  "access_token",
  "token",
];

const GUEST_COOKIE_NAME = "ai_guest_id";

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function getAuthToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(request.headers.get("cookie") || "");
  for (const name of AUTH_COOKIE_NAMES) {
    const token = cookies[name]?.trim();
    if (token) return token;
  }
  return null;
}

async function getUserId(request: Request): Promise<{ userId: string | null; guestId: string | null }> {
  const token = getAuthToken(request);
  if (!token) {
    const cookies = parseCookies(request.headers.get("cookie") || "");
    const guestId = cookies[GUEST_COOKIE_NAME]?.trim() || null;
    return { userId: null, guestId };
  }
  const tokenHash = hashSessionToken(token);
  const { data: session } = await supabase
    .from("auth_sessions")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!session) {
    const cookies = parseCookies(request.headers.get("cookie") || "");
    const guestId = cookies[GUEST_COOKIE_NAME]?.trim() || null;
    return { userId: null, guestId };
  }
  return { userId: session.user_id, guestId: null };
}

/* =========================================================
   PATCH — تعديل كتالوج
========================================================= */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, guestId } = await getUserId(request);

    if (!userId && !guestId) {
      return NextResponse.json({ success: false, error: "غير مصرح" }, { status: 401 });
    }

    /* --- التحقق من الملكية --- */
    let ownerQuery = supabase.from("categories").select("id").eq("id", id);
    if (userId) {
      ownerQuery = ownerQuery.eq("user_id", userId);
    } else {
      ownerQuery = ownerQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: existing } = await ownerQuery.maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "الكتالوج غير موجود" }, { status: 404 });
    }

    /* --- التعديل --- */
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    updates.updated_at = new Date().toISOString();

    if (body.name !== undefined) {
      const trimmed = body.name.trim().slice(0, 100);
      if (!trimmed) {
        return NextResponse.json({ success: false, error: "اسم الكتالوج لا يمكن أن يكون فارغاً" }, { status: 400 });
      }
      updates.name = trimmed;
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.color !== undefined) updates.color = body.color;
    if (body.icon !== undefined) updates.icon = body.icon || null;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
    if (body.parentId !== undefined) updates.parent_id = body.parentId || null;

    const { data: updated, error: updateError } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`فشل تعديل الكتالوج: ${updateError.message}`);
    }

    return NextResponse.json({
      success: true,
      category: updated,
      message: "تم تعديل الكتالوج بنجاح",
    });
  } catch (error) {
    console.error("[Categories] PATCH error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ أثناء تعديل الكتالوج", details: error instanceof Error ? error.message : "خطأ غير معروف" },
      { status: 500 }
    );
  }
}

/* =========================================================
   DELETE — حذف كتالوج (الملفات ترجع بدون تصنيف)
========================================================= */

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, guestId } = await getUserId(request);

    if (!userId && !guestId) {
      return NextResponse.json({ success: false, error: "غير مصرح" }, { status: 401 });
    }

    /* --- التحقق من الملكية --- */
    let ownerQuery = supabase.from("categories").select("id, name").eq("id", id);
    if (userId) {
      ownerQuery = ownerQuery.eq("user_id", userId);
    } else {
      ownerQuery = ownerQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: existing } = await ownerQuery.maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "الكتالوج غير موجود" }, { status: 404 });
    }

    /* --- نقل الملفات إلى "بدون تصنيف" --- */
    const { error: uncatError } = await supabase
      .from("documents")
      .update({ category_id: null, updated_at: new Date().toISOString() })
      .eq("category_id", id);

    if (uncatError) {
      console.error("[Categories] Error uncategorizing documents:", uncatError);
    }

    /* --- حذف الكتالوج --- */
    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", id);

    if (deleteError) {
      throw new Error(`فشل حذف الكتالوج: ${deleteError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: `تم حذف الكتالوج "${existing.name}" ونقل ملفاته إلى "بدون تصنيف"`,
    });
  } catch (error) {
    console.error("[Categories] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ أثناء حذف الكتالوج", details: error instanceof Error ? error.message : "خطأ غير معروف" },
      { status: 500 }
    );
  }
}