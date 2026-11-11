import crypto from "crypto";

import {
  UPLOAD_SESSION_TTL_SECONDS,
  STORAGE_BUCKET,
  requireEnv,
} from "@/lib/documents/upload-config";

/* =========================================================
   توكين جلسة الرفع المباشر (HMAC-SHA256)
=========================================================
   الهدف: ربط جلسة الرفع بهوية المستخدم ومسار تخزين محدد،
   بحيث لا يستطيع أحد استخدام المسار الخاص بمستخدم آخر،
   ولا تزييف مسار لرفع ملف آخر — بدون أي جدول جديد في قاعدة البيانات.

   التوكين: v1.<payload base64url>.<signature base64url>
   الحمولة: {
     b: bucket, p: storagePath, f: fileName, s: fileSize,
     c: contentType, l: lang, a: categoryId,
     u: userId | null, g: guestId | null, e: expiry (epoch ms)
   }
========================================================= */

const TOKEN_VERSION = "v1";
const HMAC_SEPARATION = ".";

export type UploadSessionPayload = {
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  contentType: string | null;
  lang: "ar" | "en";
  categoryId: string | null;
  userId: string | null;
  guestId: string | null;
  expiresAt: number;
};

/* ---------- مفتاح التوقيع (لا يغادر الخادم أبدًا) ---------- */

function getSessionSecret(): string {
  // مفتاح مخصص اختياري؛ وإلا نستخدم مفتاح الخدمة نفسه كمفتاح HMAC
  return process.env.UPLOAD_SESSION_SECRET || requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/* ---------- Base64URL helpers ---------- */

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(payloadB64Url: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64Url)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ---------- إنشاء التوكين ---------- */

export function createUploadSessionToken(
  params: Omit<UploadSessionPayload, "bucket" | "expiresAt"> & { bucket?: string }
): string {
  const payload: UploadSessionPayload = {
    bucket: params.bucket || STORAGE_BUCKET,
    storagePath: params.storagePath,
    fileName: params.fileName,
    fileSize: params.fileSize,
    contentType: params.contentType,
    lang: params.lang,
    categoryId: params.categoryId,
    userId: params.userId,
    guestId: params.guestId,
    expiresAt: Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000,
  };

  const payloadB64Url = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadB64Url);

  return `${TOKEN_VERSION}${HMAC_SEPARATION}${payloadB64Url}${HMAC_SEPARATION}${signature}`;
}

/* ---------- التحقق من التوكين ---------- */

export function verifyUploadSessionToken(token: string): UploadSessionPayload | null {
  if (!token) return null;

  const parts = token.split(HMAC_SEPARATION);
  if (parts.length !== 3) return null;

  const [version, payloadB64Url, signature] = parts;
  if (version !== TOKEN_VERSION) return null;

  const expectedSignature = sign(payloadB64Url);
  const given = fromBase64Url(signature);
  const expected = fromBase64Url(expectedSignature);

  // مقارنة آمنة ضد Timing attacks
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadB64Url).toString("utf-8")) as UploadSessionPayload;

    if (!payload.storagePath || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

/* ---------- التحقق من تطابق الهوية ---------- */

export function sessionMatchesIdentity(payload: UploadSessionPayload, identity: { userId: string | null; guestId: string | null }): boolean {
  if (payload.userId) return payload.userId === identity.userId;
  if (payload.guestId) return Boolean(identity.guestId) && payload.guestId === identity.guestId;
  return false;
}
