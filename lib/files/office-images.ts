import JSZip from "jszip";
import { readFile } from "fs/promises";

/* =========================================================
   استخراج الصور المدمجة من ملفات Office (docx / pptx)
========================================================= */

export type ExtractedOfficeImage = {
  buffer: Buffer;
  mimeType: string;
  /** للـ pptx: رقم الشريحة التقريبي */
  slideNumber?: number;
  name: string;
};

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/emf",
  "image/x-emf",
]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/x-wmf",
};

const MIN_IMAGE_BYTES = 3 * 1024; // تجاهل الأيقونات الصغيرة
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function extractOfficeImages(
  filePath: string,
  options: { maxImages?: number } = {}
): Promise<ExtractedOfficeImage[]> {
  const maxImages = options.maxImages ?? 30;

  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const entries = Object.keys(zip.files).filter((name) => {
    const isWord = /^word\/media\//i.test(name);
    const isPpt = /^ppt\/media\//i.test(name);
    return (isWord || isPpt) && !name.endsWith("/");
  });

  // ترتيب طبيعي للملفات (image1, image2, ... image10)
  entries.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)\.\w+$/)?.[1] || "0", 10);
    const nb = parseInt(b.match(/(\d+)\.\w+$/)?.[1] || "0", 10);
    return na - nb;
  });

  const images: ExtractedOfficeImage[] = [];

  for (const name of entries) {
    if (images.length >= maxImages) break;

    const ext = name.split(".").pop()?.toLowerCase() || "";
    const mimeType = EXT_TO_MIME[ext];

    if (!mimeType || !ALLOWED_IMAGE_MIMES.has(mimeType)) continue;
    // EMF/WMF لا تُعرض في المتصفح — تُتجاهل (تظهر في تصوير صفحات PDF فقط)
    if (mimeType === "image/emf" || mimeType === "image/x-emf" || mimeType === "image/x-wmf") continue;

    const data = await zip.files[name].async("nodebuffer");

    if (data.length < MIN_IMAGE_BYTES || data.length > MAX_IMAGE_BYTES) continue;

    // رقم الشريحة من الاسم التقريبي — الصور في ppt/media غير مرتبطة بشرائح
    // مباشرة، لذا نعتمد ترتيبها فقط
    images.push({
      buffer: data,
      mimeType,
      name: name.split("/").pop() || name,
    });
  }

  return images;
}
