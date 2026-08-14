import { NextResponse } from "next/server";
import { analyzeDocument } from "@/lib/ai/analyzer";

export async function POST(req: Request) {
  try {
    const { text, lang } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }
    const selectedLang = lang === "en" ? "en" : "ar";
    const analysis = await analyzeDocument(text, selectedLang);
    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}