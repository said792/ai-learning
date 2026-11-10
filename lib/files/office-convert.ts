import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import crypto from "crypto";
import { mkdir, access, rm } from "fs/promises";

const execFileAsync = promisify(execFile);

/* =========================================================
   تحويل صيغ Office القديمة عبر LibreOffice (soffice)
   .doc / .ppt / .xls / .odt / .odp / .ods / .rtf / .wps ...
========================================================= */

const TIMEOUT_MS = 180_000;

let sofficePath: string | null | undefined;

/** هل LibreOffice متوفر على الخادم؟ */
export async function hasLibreOffice(): Promise<boolean> {
  if (sofficePath !== undefined) return sofficePath !== null;

  const candidates = [
    "soffice",
    "/usr/bin/soffice",
    "/opt/libreoffice/program/soffice",
    "/usr/local/bin/soffice",
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 15_000 });
      sofficePath = candidate;
      return true;
    } catch {
      /* المحاولة التالية */
    }
  }

  sofficePath = null;
  return false;
}

/**
 * تحويل ملف إلى صيغة أخرى باستخدام LibreOffice
 * @returns مسار الملف المحوَّل (في مجلد مؤقت)
 */
export async function convertWithLibreOffice(
  filePath: string,
  targetFormat: "docx" | "pptx" | "xlsx" | "pdf" | "txt" | "csv"
): Promise<string> {
  if (!(await hasLibreOffice())) {
    throw new Error(
      "صيغة الملف قديمة وتحتاج LibreOffice على الخادم. ثبّته عبر: apt-get install -y libreoffice"
    );
  }

  const tmpDir = path.join(os.tmpdir(), `ai-convert-${crypto.randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    await execFileAsync(
      sofficePath as string,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        targetFormat,
        "--outdir",
        tmpDir,
        filePath,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );

    const base = path.basename(filePath, path.extname(filePath));
    const convertedPath = path.join(tmpDir, `${base}.${targetFormat}`);

    await access(convertedPath);

    return convertedPath;
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
      throw new Error("انتهت مهلة تحويل الملف عبر LibreOffice");
    }

    throw new Error(
      `فشل تحويل الملف (${path.extname(filePath)}) عبر LibreOffice: ${message.substring(0, 150)}`
    );
  }
}

/** تنظيف مجلد مؤقت بعد الاستخدام */
export async function cleanupConverted(fileDirOrPath: string): Promise<void> {
  try {
    const parent = path.dirname(fileDirOrPath);
    if (parent.startsWith("/tmp/ai-convert-")) {
      await rm(parent, { recursive: true, force: true });
    }
  } catch {
    /* silent */
  }
}
