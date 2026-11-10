import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserId } from "@/lib/usage";
import { getSignedAssetUrls } from "@/lib/files/document-images";

export const runtime = "nodejs";

/* =========================================================
   GET /api/documents/[id]/assets
   صور المستند مع روابط موقعة وتحليل كل صورة
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

    const cookieStore = await cookies();
    const userId = await getCurrentUserId();
    const guestId = cookieStore.get("ai_guest_id")?.value || null;

    if (!userId && !guestId) {
      return NextResponse.json(
        { success: false, error: "سجل الدخول أو استخدم التطبيق كزائر أولاً" },
        { status: 401 }
      );
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

    if (docError || !document) {
      return NextResponse.json(
        { success: false, error: "المستند غير موجود" },
        { status: 404 }
      );
    }

    const { data: assets, error } = await supabaseAdmin
      .from("document_assets")
      .select(
        "id, storage_path, mime_type, page_number, source, analysis, sort_order"
      )
      .eq("document_id", id)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[Document Assets] Fetch error:", error);
      return NextResponse.json(
        { success: false, error: "حدث خطأ أثناء تحميل صور المستند" },
        { status: 500 }
      );
    }

    const signedUrls = await getSignedAssetUrls(
      (assets || []).map((a) => a.storage_path)
    );

    return NextResponse.json({
      success: true,
      assets: (assets || []).map((asset) => ({
        id: asset.id,
        url: signedUrls[asset.storage_path] || null,
        mimeType: asset.mime_type,
        pageNumber: asset.page_number,
        source: asset.source,
        analysis: asset.analysis,
        sortOrder: asset.sort_order,
      })),
    });
  } catch (error) {
    console.error("[Document Assets] API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      },
      { status: 500 }
    );
  }
}
