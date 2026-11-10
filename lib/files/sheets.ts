import * as XLSX from "xlsx";
import { readFile } from "fs/promises";
import path from "path";
import { convertWithLibreOffice } from "@/lib/files/office-convert";

/* =========================================================
   استخراج نص الجداول: xlsx / xls / ods / csv
========================================================= */

function sheetToText(sheet: XLSX.WorkSheet): string {
  // قراءة كخلايا مدمجة نصيًا مع الحفاظ على البنية
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  return rows
    .map((row) =>
      row
        .map((cell) => String(cell ?? "").trim())
        .filter((cell) => cell !== "")
        .join(" | ")
    )
    .filter((line) => line.trim() !== "")
    .join("\n");
}

export async function extractSpreadsheetText(
  filePath: string,
  maxRows = 5_000
): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  let targetPath = filePath;

  // الصيغ القديمة/المفتوحة تُحوَّل عبر LibreOffice أولاً
  if (ext === ".xls" || ext === ".ods") {
    console.log(`[Excel] تحويل ${ext} عبر LibreOffice: ${path.basename(filePath)}`);
    targetPath = await convertWithLibreOffice(filePath, "xlsx");
  }

  const buffer = await readFile(targetPath);

  if (ext === ".csv") {
    // CSV يُقرأ نصًا مباشرًا للحفاظ على البنية
    return buffer.toString("utf-8").replace(/\r\n/g, "\n").trim();
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });

  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    // حد أقصى للصفوف لتفادي الملفات الضخمة
    const range = sheet["!ref"] || "A1:A1";
    const parsed = XLSX.utils.decode_range(range);

    let limitedSheet = sheet;
    if (parsed.e.r - parsed.s.r > maxRows) {
      limitedSheet = {} as XLSX.WorkSheet;
      Object.assign(limitedSheet, sheet);
      limitedSheet["!ref"] = XLSX.utils.encode_range({
        s: parsed.s,
        e: { r: parsed.s.r + maxRows, c: parsed.e.c },
      });
    }

    const text = sheetToText(limitedSheet);

    if (text) {
      parts.push(`=== ورقة: ${sheetName} ===\n${text}`);
    }
  }

  const combined = parts.join("\n\n").trim();

  if (!combined) {
    throw new Error("لم يتم العثور على بيانات داخل ملف الجدول");
  }

  return combined;
}
