import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/* =========================================================
   Hash Session Token
========================================================= */

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* =========================================================
   Get Current User
========================================================= */

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();

  const token = cookieStore.get("ai_learning_session")?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const { data: session, error } = await supabase
    .from("auth_sessions")
    .select(`
      id,
      user_id,
      expires_at
    `)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("[Document Details] Session lookup error:", error);
    return null;
  }

  if (!session) {
    return null;
  }

  if (new Date(session.expires_at) < new Date()) {
    await supabase
      .from("auth_sessions")
      .delete()
      .eq("id", session.id);

    return null;
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select(`
      id,
      is_active
    `)
    .eq("id", session.user_id)
    .maybeSingle();

  if (userError) {
    console.error("[Document Details] User lookup error:", userError);
    return null;
  }

  if (!user || user.is_active === false) {
    return null;
  }

  return user.id;
}

/* =========================================================
   GET Document
========================================================= */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "معرف المستند غير صالح",
        },
        { status: 400 }
      );
    }

    const userId = await getCurrentUserId();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          authenticated: false,
          error: "يجب تسجيل الدخول لعرض مستنداتك",
        },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
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
        created_at
      `)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "completed")
      .maybeSingle();

    if (error) {
      console.error("[Document Details] Fetch error:", error);

      return NextResponse.json(
        {
          success: false,
          error: "حدث خطأ أثناء تحميل المستند",
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: "المستند غير موجود",
        },
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