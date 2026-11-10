import { mkdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

/* =========================================================
   تحويل صفحات PDF إلى صور PNG
   (pdfjs-dist legacy + @napi-rs/canvas — بدون أدوات نظام)
========================================================= */

export type RenderedPage = {
  pageNumber: number;
  buffer: Buffer;
  width: number;
  height: number;
};

export async function renderPdfPages(
  filePath: string,
  options: { maxPages?: number; targetWidth?: number } = {}
): Promise<RenderedPage[]> {
  const maxPages = options.maxPages ?? 20;
  const targetWidth = options.targetWidth ?? 1100;

  // الاستيراد الديناميكي لبناء legacy يعمل في Node
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(await (await import("fs/promises")).readFile(filePath)),
    // تعطيل أي خدمات شبكة/عامل خارجي
    disableWorker: true,
    useSystemFonts: false,
    isEvalSupported: false,
  } as never);

  const pdf = await loadingTask.promise;

  const { createCanvas } = await import("@napi-rs/canvas");

  const pagesToRender = Math.min(pdf.numPages, maxPages);
  const rendered: RenderedPage[] = [];

  for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
    const page = await pdf.getPage(pageNum);

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );
    const context = canvas.getContext("2d");

    // خلفية بيضاء (بعض الـ PDF شفافة)
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas,
    } as never).promise;

    rendered.push({
      pageNumber: pageNum,
      buffer: canvas.toBuffer("image/png"),
      width: canvas.width,
      height: canvas.height,
    });

    page.cleanup();
  }

  await pdf.destroy();

  return rendered;
}

/**
 * حفظ الصور مؤقتًا على القرص (لرفعها لاحقًا أو إدخالها في ffmpeg)
 */
export async function saveBuffersToTempDir(
  buffers: Array<{ buffer: Buffer; suffix?: string }>,
  prefix = "ai-img"
): Promise<string[]> {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });

  const paths: string[] = [];

  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(dir, `${i}${buffers[i].suffix || ".png"}`);
    await writeFile(p, buffers[i].buffer);
    paths.push(p);
  }

  return paths;
}
