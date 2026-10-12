import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { hashSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/* =========================================================
   Supabase
========================================================= */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* =========================================================
   Cookie Helpers
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
   Preset Colors
========================================================= */

export const PRESET_COLORS = [
  { name: "أزرق", nameEn: "Blue", value: "#3B82F6" },
  { name: "أخضر", nameEn: "Green", value: "#10B981" },
  { name: "أحمر", nameEn: "Red", value: "#EF4444" },
  { name: "أصفر", nameEn: "Yellow", value: "#F59E0B" },
  { name: "بنفسجي", nameEn: "Purple", value: "#8B5CF6" },
  { name: "وردي", nameEn: "Pink", value: "#EC4899" },
  { name: "برتقالي", nameEn: "Orange", value: "#F97316" },
  { name: "سماوي", nameEn: "Cyan", value: "#06B6D4" },
  { name: "رمادي", nameEn: "Gray", value: "#6B7280" },
  { name: "زيتوني", nameEn: "Olive", value: "#84CC16" },
];

/* =========================================================
   GET — جلب كل الكتالوجات مع عدد الملفات
========================================================= */

export async function GET(request: Request) {
  try {
    const { userId, guestId } = await getUserId(request);

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "غير مصرح" },
        { status: 401 }
      );
    }

    /* --- جلب الكتالوجات --- */
    let catQuery = supabase
      .from("categories")
      .select("id, name, description, color, icon, parent_id, sort_order, created_at, updated_at")
      .order("sort_order", { ascending: true });

    if (userId) {
      catQuery = catQuery.eq("user_id", userId).is("guest_id", null);
    } else {
      catQuery = catQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: categories, error: catError } = await catQuery;

    if (catError) {
      throw new Error(`فشل جلب الكتالوجات: ${catError.message}`);
    }

    /* --- جلب عدد الملفات لكل كتالوج --- */
    const categoryIds = (categories || []).map((c) => c.id);

    let docCountMap: Record<string, number> = {};

    if (categoryIds.length > 0) {
      const { data: docCounts, error: countError } = await supabase
        .from("documents")
        .select("category_id")
        .in("category_id", categoryIds);

      if (!countError && docCounts) {
        for (const doc of docCounts) {
          const cid = doc.category_id;
          if (cid) {
            docCountMap[cid] = (docCountMap[cid] || 0) + 1;
          }
        }
      }
    }

    /* --- عدد الملفات بدون تصنيف --- */
    let uncatQuery = supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .is("category_id", null);

    if (userId) {
      uncatQuery = uncatQuery.eq("user_id", userId);
    } else {
      uncatQuery = uncatQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { count: uncategorizedCount } = await uncatQuery;

    /* --- النتيجة --- */
    const result = (categories || []).map((cat) => ({
      ...cat,
      documentCount: docCountMap[cat.id] || 0,
    }));

    return NextResponse.json({
      success: true,
      categories: result,
      uncategorizedCount: uncategorizedCount || 0,
      presetColors: PRESET_COLORS,
    });
  } catch (error) {
    console.error("[Categories] GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "حدث خطأ أثناء جلب الكتالوجات",
        details: error instanceof Error ? error.message : "خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}

/* =========================================================
   POST — إنشاء كتالوج جديد
========================================================= */

export async function POST(request: Request) {
  try {
    const { userId, guestId } = await getUserId(request);

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "غير مصرح" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, color, icon, parentId } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "اسم الكتالوج مطلوب" },
        { status: 400 }
      );
    }

    const trimmedName = name.trim().slice(0, 100);
    const categoryColor = color || "#3B82F6";

    /* --- التحقق من عدم تكرار الاسم --- */
    let dupQuery = supabase
      .from("categories")
      .select("id")
      .eq("name", trimmedName);

    if (userId) {
      dupQuery = dupQuery.eq("user_id", userId).is("guest_id", null);
    } else {
      dupQuery = dupQuery.eq("guest_id", guestId).is("user_id", null);
    }

    const { data: existing } = await dupQuery.maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: "يوجد كتالوج بنفس الاسم بالفعل" },
        { status: 409 }
      );
    }

    /* --- إنشاء الكتالوج --- */
    const insertData: Record<string, unknown> = {
      name: trimmedName,
      description: description?.trim() || null,
      color: categoryColor,
      icon: icon || null,
      parent_id: parentId || null,
      user_id: userId,
      guest_id: userId ? null : guestId,
    };

    const { data: newCategory, error: insertError } = await supabase
      .from("categories")
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      throw new Error(`فشل إنشاء الكتالوج: ${insertError.message}`);
    }

    return NextResponse.json(
      {
        success: true,
        category: { ...newCategory, documentCount: 0 },
        message: `تم إنشاء الكتالوج "${trimmedName}" بنجاح`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Categories] POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "حدث خطأ أثناء إنشاء الكتالوج",
        details: error instanceof Error ? error.message : "خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}