/* =========================================================
   تسجيل كل صيغ الملفات المدعومة — المصدر الوحيد للحقيقة
========================================================= */

export type FileKind =
  | "pdf"
  | "word"
  | "powerpoint"
  | "excel"
  | "text"
  | "image"
  | "audio"
  | "video";

export type FileFormatInfo = {
  extension: string;
  kind: FileKind;
  /** يحتاج LibreOffice على الخادم */
  needsLibreOffice?: boolean;
};

export const IMAGE_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".bmp",
  ".tiff", ".tif", ".gif", ".heic", ".heif", ".svg",
];

export const AUDIO_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus",
  ".flac", ".aac", ".wma", ".aiff", ".aif", ".weba", ".m4b",
];

export const VIDEO_EXTENSIONS = [
  ".mp4", ".webm", ".mov", ".avi", ".wmv", ".mkv",
  ".m4v", ".3gp", ".flv", ".mpg", ".mpeg", ".ts",
];

export const DOCUMENT_EXTENSIONS = [
  // مستندات حديثة
  ".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md", ".csv", ".html", ".htm",
  // مستندات قديمة (تحتاج LibreOffice)
  ".doc", ".ppt", ".xls", ".rtf", ".odt", ".odp", ".ods", ".epub", ".wps",
];

export const ALL_SUPPORTED_EXTENSIONS = [
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
];

const KIND_MAP: Record<string, FileFormatInfo> = (() => {
  const map: Record<string, FileFormatInfo> = {};

  for (const ext of DOCUMENT_EXTENSIONS) {
    let kind: FileKind = "text";
    if (ext === ".pdf") kind = "pdf";
    else if (ext === ".docx" || ext === ".doc" || ext === ".odt" || ext === ".rtf" || ext === ".wps" || ext === ".epub") kind = "word";
    else if (ext === ".pptx" || ext === ".ppt" || ext === ".odp") kind = "powerpoint";
    else if (ext === ".xlsx" || ext === ".xls" || ext === ".ods" || ext === ".csv") kind = "excel";

    map[ext] = {
      extension: ext,
      kind,
      needsLibreOffice: [".doc", ".ppt", ".xls", ".odt", ".odp", ".ods", ".rtf", ".wps"].includes(ext),
    };
  }

  for (const ext of IMAGE_EXTENSIONS) {
    map[ext] = { extension: ext, kind: "image" };
  }

  for (const ext of AUDIO_EXTENSIONS) {
    map[ext] = { extension: ext, kind: "audio" };
  }

  for (const ext of VIDEO_EXTENSIONS) {
    map[ext] = { extension: ext, kind: "video" };
  }

  return map;
})();

export function getFormatInfo(extension: string): FileFormatInfo | null {
  return KIND_MAP[extension.toLowerCase()] || null;
}

export function isSupportedExtension(extension: string): boolean {
  return Boolean(KIND_MAP[extension.toLowerCase()]);
}

/** MIME types للصور (للرفع والتحليل) */
export const IMAGE_MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
};

/** قائمة القبول في input[type=file] */
export const FILE_INPUT_ACCEPT =
  ALL_SUPPORTED_EXTENSIONS.join(",");
