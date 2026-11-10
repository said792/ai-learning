/* اختبار دخاني سريع للوحدات الحرجة — يعمل محليًا بدون Gemini */
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-smoke-"));
  const results: Array<{ name: string; ok: boolean; extra?: string }> = [];

  const check = (name: string, ok: boolean, extra = "") => {
    results.push({ name, ok, extra });
    console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
  };

  // ===== 1) pptx extraction (jszip مباشر) =====
  try {
    const JSZip = require("jszip");
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:p><a:r><a:t>مرحبا بكم في الدرس الأول</a:t></a:r></a:p></p:sld>`);
    zip.file("ppt/slides/slide2.xml", `<a:p><a:r><a:t>النقطة الثانية</a:t></a:r></a:p>`);
    zip.file("ppt/slides/slide10.xml", `<a:p><a:r><a:t>الشريحة العاشرة</a:t></a:r></a:p>`);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const pptxPath = path.join(tmp, "test.pptx");
    fs.writeFileSync(pptxPath, buf);

    const { extractPowerPointText } = await import("@/lib/files/powerpoint");
    const text = await extractPowerPointText(pptxPath);

    // التسمية تسلسلية حسب الموضع، والترتيب رقمي صحيح (slide10 الأخيرة)
    const hasAll =
      text.includes("مرحبا بكم") &&
      text.includes("النقطة الثانية") &&
      text.includes("الشريحة العاشرة") &&
      text.indexOf("مرحبا بكم") < text.indexOf("النقطة الثانية") &&
      text.indexOf("النقطة الثانية") < text.indexOf("الشريحة العاشرة");

    check("pptx extraction (jszip + ترتيب الشرائح)", hasAll, `${text.length} chars`);
  } catch (e) {
    check("pptx extraction", false, (e as Error).message);
  }

  // ===== 2) WAV encoder =====
  try {
    const { pcmToWav, wavDurationSeconds, concatWavBuffers } = await import("@/lib/wav");
    const pcm = Buffer.alloc(24000 * 2 * 2, 0); // ثانيتان
    const wav = pcmToWav(pcm, 24000, 1, 16);
    const dur = wavDurationSeconds(wav);

    const wav2 = pcmToWav(pcm, 24000, 1, 16);
    const merged = concatWavBuffers([wav, wav2]);
    const mergedDur = wavDurationSeconds(merged);

    check(
      "WAV encoder + دمج",
      Math.abs(dur - 2) < 0.1 && Math.abs(mergedDur - 4) < 0.15,
      `2s→${dur.toFixed(2)}s, merged→${mergedDur.toFixed(2)}s`
    );
  } catch (e) {
    check("WAV encoder", false, (e as Error).message);
  }

  // ===== 3) شرائح SVG → PNG (عربي كامل) =====
  try {
    const { renderCoverSlide, renderContentSlide } = await import("@/lib/lessons/slides");
    const cover = renderCoverSlide({ title: "الدرس التجريبي الأول", subtitle: "اختبار التشغيل" });
    const content = renderContentSlide({
      heading: "المقدمة والتعريفات",
      bullets: ["النقطة الأولى المهمة", "النقطة الثانية: 25% من الإجمالي", "النقطة الثالثة (Art. 12)"],
      sectionNumber: 2,
      totalSections: 6,
    });
    check(
      "شرائح SVG → PNG (عربي RTL)",
      cover.length > 5000 && content.length > 5000,
      `cover=${(cover.length / 1024).toFixed(0)}KB content=${(content.length / 1024).toFixed(0)}KB`
    );
  } catch (e) {
    check("SVG slides", false, (e as Error).message);
  }

  // ===== 4) LibreOffice: RTF → نص (عبر مسار word.ts) =====
  try {
    const rtf = `{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}}\\f0\\fs24 \\u1605\\u1585\\u1581\\u1576\\u1575 \\u1576\\u1603\\u1605 \\u1601\\u1610 \\u1575\\u1604\\u1583\\u1585\\u1587\\par}`;
    const rtfPath = path.join(tmp, "sample.rtf");
    fs.writeFileSync(rtfPath, rtf, "utf-8");

    const { extractWordText } = await import("@/lib/files/word");
    const text = await extractWordText(rtfPath);

    check("LibreOffice RTF → نص", text.includes("مرحبا"), `"${text.trim().substring(0, 30)}"`);
  } catch (e) {
    check("LibreOffice conversion", false, (e as Error).message);
  }

  // ===== 5) ffmpeg متوفر + استخراج صوت =====
  try {
    // توليد صوت تجريبي 2 ثانية ثم قراءته عبر المسار الكامل
    const tonePath = path.join(tmp, "tone.wav");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "16000", "-ac", "1", tonePath], { timeout: 30000 });

    const { extractAudioFromVideo } = await import("@/lib/files/video");
    const outPath = path.join(tmp, "tone-out.wav");
    await extractAudioFromVideo(tonePath, outPath);

    const size = fs.statSync(outPath).size;
    check("ffmpeg استخراج صوت", size > 10000, `${(size / 1024).toFixed(0)}KB`);
  } catch (e) {
    check("ffmpeg", false, (e as Error).message);
  }

  // ===== 6) PDF → صفحات مصورة (pdfjs + canvas) =====
  try {
    const txtPath = path.join(tmp, "sample.txt");
    fs.writeFileSync(txtPath, "تجربة تصوير صفحات PDF\nSecond line content", "utf-8");
    const pdfPath = path.join(tmp, "sample.pdf");
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", tmp, txtPath], { timeout: 60000 });

    if (!fs.existsSync(pdfPath)) throw new Error("soffice لم ينتج PDF");

    const { renderPdfPages } = await import("@/lib/files/pdf-images");
    const pages = await renderPdfPages(pdfPath, { maxPages: 3, targetWidth: 800 });

    check(
      "PDF → تصوير صفحات",
      pages.length >= 1 && pages[0].buffer.length > 10000,
      `${pages.length} صفحة، الأولى ${(pages[0]?.buffer.length / 1024).toFixed(0)}KB`
    );
  } catch (e) {
    check("PDF pages render", false, (e as Error).message);
  }

  // ===== 7) استخراج صور من docx =====
  try {
    const JSZip = require("jszip");
    // PNG صغير 1×1 حقيقي
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    // تكبيره ليعدى حد 3KB
    const pngBig = Buffer.concat([tinyPng, Buffer.alloc(4 * 1024, 0)]);

    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document></w:document>");
    zip.file("word/media/image1.png", pngBig);
    zip.file("word/media/image2.txt", "not an image");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const docxPath = path.join(tmp, "test.docx");
    fs.writeFileSync(docxPath, buf);

    const { extractOfficeImages } = await import("@/lib/files/office-images");
    const images = await extractOfficeImages(docxPath);

    check("استخراج صور docx", images.length === 1 && images[0].mimeType === "image/png", `${images.length} صورة`);
  } catch (e) {
    check("docx images", false, (e as Error).message);
  }

  // ===== 8) استخراج xlsx =====
  try {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["الاسم", "الدرجة"],
      ["أحمد", 95],
      ["سارة", 88],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "النتائج");
    const xlsxPath = path.join(tmp, "grades.xlsx");
    XLSX.writeFile(wb, xlsxPath);

    const { extractSpreadsheetText } = await import("@/lib/files/sheets");
    const text = await extractSpreadsheetText(xlsxPath);

    check("استخراج xlsx", text.includes("أحمد") && text.includes("95"), `${text.length} chars`);
  } catch (e) {
    check("xlsx extraction", false, (e as Error).message);
  }

  // ===== 9) chunking للـ TTS =====
  try {
    const { chunkTextForTts } = await import("@/lib/ai/tts");
    const longText = Array.from({ length: 200 }, (_, i) => `هذه هي الجملة رقم ${i + 1} في النص الطويل للتجربة.`).join(" ");
    const chunks = chunkTextForTts(longText, 1000);
    const allJoined = chunks.join(" ").length >= longText.length * 0.95;

    check(
      "تقطيع نص TTS",
      chunks.length > 1 && chunks.every((c: string) => c.length <= 1000) && allJoined,
      `${chunks.length} مقاطع`
    );
  } catch (e) {
    check("TTS chunking", false, (e as Error).message);
  }

  // ===== 10) تسجيل الصيغ المدعومة =====
  try {
    const { ALL_SUPPORTED_EXTENSIONS, isSupportedExtension } = await import("@/lib/files/registry");
    const samples = [".pdf", ".doc", ".ppt", ".xls", ".xlsx", ".csv", ".epub", ".rtf", ".mp4", ".mp3", ".heic", ".svg"];
    const allOk = samples.every((s) => isSupportedExtension(s));

    check("سجل الصيغ", allOk && ALL_SUPPORTED_EXTENSIONS.length >= 50, `${ALL_SUPPORTED_EXTENSIONS.length} صيغة`);
  } catch (e) {
    check("registry", false, (e as Error).message);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n===== النتيجة: ${passed}/${results.length} اختبارات ناجحة =====`);

  fs.rmSync(tmp, { recursive: true, force: true });

  if (passed < results.length) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE TEST CRASH:", e);
  process.exit(1);
});
