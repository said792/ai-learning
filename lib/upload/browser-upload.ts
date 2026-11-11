"use client";

/* =========================================================
   الرفع المباشر من المتصفح إلى Supabase Storage
=========================================================
   بدل إرسال الملف عبر Vercel API (الذي يرفض الطلبات أكبر من
   4.5MB بخطأ HTTP 413)، يقوم المتصفح برفع الملف مباشرة إلى
   Supabase Storage بطريقة واحدة من اثنتين:

   1) direct     — ملف صغير: POST واحد للـ Signed Upload URL
                   مع شريط تقدم عبر XHR.
   2) resumable  — ملف كبير: بروتوكول TUS (رفع مقسّم)
                   مباشرة إلى Supabase، مع:
                   - شريط تقدم
                   - استكمال تلقائي عند انقطاع الإنترنت
                   - استكمال بعد إعادة تحميل الصفحة
                   - توكين x-signature الصادر من الخادم

   لا يُكشف هنا أي مفتاح حساس — كل ما نستخدمه هو:
   NEXT_PUBLIC_SUPABASE_URL (عام بالفعل) + توكين موقّع مؤقت
   صادر من الخادم ومرتبط بمسار محدد وصلاحية ساعتين.
========================================================= */

const TUS_RESUMABLE_VERSION = "1.0.0";
const RESUME_STORAGE_KEY = "nexora_tus_upload_resume";

/** حجم القطعة الافتراضي لرفع TUS — 6MB كما توصي Supabase رسميًا */
export const DEFAULT_TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** أقصى عدد محاولات إعادة لكل قطعة عند انقطاع الاتصال */
const MAX_CHUNK_RETRIES = 8;
/** التأخير بين المحاولات (ملي ثانية) — تراجع تدريجي */
const RETRY_DELAYS_MS = [0, 1000, 3000, 8000, 15000, 30000, 30000, 30000];

export type UploadMode = "direct" | "resumable";

export type InitUploadResponse = {
  success: boolean;
  mode?: UploadMode;
  bucket?: string;
  storagePath?: string;
  signedUrl?: string;
  signatureToken?: string;
  sessionToken?: string;
  usage?: Record<string, unknown>;
  error?: string;
  limitReached?: boolean;
  usedToday?: number;
  dailyLimit?: number;
  usedThisMonth?: number | null;
  monthlyLimit?: number | null;
};

export type UploadProgressCallback = (percent: number, bytesUploaded: number, bytesTotal: number) => void;

/* =========================================================
   أخطاء مفهومة للواجهة
========================================================= */

export class UploadClientError extends Error {
  status?: number;
  retryable: boolean;
  /** لو صحيح: يمكن تجربة الرفع المباشر بطلب واحد كخطة بديلة */
  fallbackToDirect: boolean;

  constructor(message: string, options?: { status?: number; retryable?: boolean; fallbackToDirect?: boolean }) {
    super(message);
    this.name = "UploadClientError";
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
    this.fallbackToDirect = options?.fallbackToDirect ?? false;
  }
}

/* =========================================================
   أدوات مساعدة
========================================================= */

function fileKey(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function encodeTusMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${utf8Base64(value)}`)
    .join(",");
}

/** استنتاج عنوان Storage المباشر من عنوان المشروع */
function resolveStorageBaseUrl(supabaseUrl: string): string {
  try {
    const url = new URL(supabaseUrl);
    // xyz.supabase.co → xyz.storage.supabase.co (أسرع — توصية Supabase)
    if (url.hostname.endsWith(".supabase.co") && !url.hostname.startsWith("storage.")) {
      const projectRef = url.hostname.split(".")[0];
      return `https://${projectRef}.storage.supabase.co`;
    }
  } catch {
    /* عنوان غير قياسي — استخدمه كما هو */
  }
  return supabaseUrl.replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** قراءة رسالة خطأ JSON من استجابة Supabase */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        return json.message || json.error || json.msg || text.slice(0, 300);
      } catch {
        return text.slice(0, 300);
      }
    }
  } catch {
    /* تجاهل */
  }
  return fallback;
}

/* =========================================================
   حالة الاستكمال (sessionStorage — تبقى بعد إعادة تحميل الصفحة)
========================================================= */

export type ResumeState = {
  key: string;
  location: string;
  offset: number;
  sessionToken: string;
  signatureToken: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  lang: "ar" | "en";
  categoryId: string | null;
  contentType: string | null;
  savedAt: number;
};

function loadResumeState(file: File): ResumeState | null {
  try {
    const raw = sessionStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as ResumeState;
    /* نتجاهل الجلسات الأقدم من ساعتين (نفس صلاحية Signed URL) */
    if (state.key !== fileKey(file) || Date.now() - state.savedAt > 2 * 60 * 60 * 1000) {
      sessionStorage.removeItem(RESUME_STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function saveResumeState(state: ResumeState): void {
  try {
    sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* الحفظ اختياري — لا نوقف الرفع بسبب محدودية التخزين */
  }
}

function clearResumeState(): void {
  try {
    sessionStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    /* تجاهل */
  }
}

/* =========================================================
   الخطوة 1: init — طلب جلسة رفع من الخادم
========================================================= */

export async function initUpload(params: {
  file: File;
  lang: "ar" | "en";
  categoryId: string | null;
}): Promise<InitUploadResponse> {
  const response = await fetch("/api/documents/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: params.file.name,
      fileSize: params.file.size,
      contentType: params.file.type || null,
      lang: params.lang,
      categoryId: params.categoryId,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as InitUploadResponse;

  if (!response.ok || !data.success) {
    throw new UploadClientError(data.error || "تعذر تهيئة جلسة الرفع", {
      status: response.status,
    });
  }

  return data;
}

/* =========================================================
   الطريقة 1: رفع مباشر بطلب واحد (ملفات صغيرة) مع تقدم XHR
========================================================= */

export function uploadDirectToSignedUrl(params: {
  signedUrl: string;
  file: File;
  onProgress: UploadProgressCallback;
  signal: AbortSignal;
}): Promise<void> {
  const { signedUrl, file, onProgress, signal } = params;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signedUrl, true);
    xhr.setRequestHeader("x-upsert", "true");
    if (file.type) {
      xhr.setRequestHeader("Content-Type", file.type);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(
          Math.round((event.loaded / event.total) * 100),
          event.loaded,
          event.total
        );
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      let message = `فشل رفع الملف إلى التخزين (${xhr.status})`;
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.message || json.error) message = json.message || json.error;
      } catch {
        /* الرسالة الافتراضية */
      }

      /* تجاوز حد حجم الملف في Supabase (مثلًا 50MB على الخطة المجانية) */
      const isSizeLimit =
        xhr.status === 413 ||
        /too large|payload too large|file size/i.test(xhr.responseText);
      if (isSizeLimit) {
        message =
          "حجم الملف أكبر من الحد المسموح في إعدادات Supabase Storage حاليًا. " +
          "الخطة المجانية تسمح بـ 50MB للملف — عند الترقية إلى Pro يمكن رفع الحد من إعدادات التخزين.";
      }

      reject(new UploadClientError(message, { status: xhr.status }));
    };

    xhr.onerror = () =>
      reject(new UploadClientError("انقطع الاتصال أثناء رفع الملف", { retryable: true }));
    xhr.onabort = () =>
      reject(new UploadClientError("تم إلغاء الرفع", { status: 499 }));

    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.addEventListener("loadend", () => signal.removeEventListener("abort", abort));

    xhr.send(file);
  });
}

/* =========================================================
   الطريقة 2: رفع TUS مقسّم قابل للاستكمال (ملفات كبيرة)
========================================================= */

async function createTusSession(params: {
  supabaseUrl: string;
  file: File;
  bucket: string;
  storagePath: string;
  contentType: string | null;
  signatureToken: string;
}): Promise<string> {
  const endpoint = `${resolveStorageBaseUrl(params.supabaseUrl)}/storage/v1/upload/resumable`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "x-signature": params.signatureToken,
      "x-upsert": "true",
      "Upload-Length": String(params.file.size),
      "Upload-Metadata": encodeTusMetadata({
        bucketName: params.bucket,
        objectName: params.storagePath,
        contentType: params.contentType || "application/octet-stream",
        cacheControl: "3600",
      }),
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "فشل إنشاء جلسة الرفع المقسّم");

    /* أخطاء المصادقة/الطريقة تعني غالبًا أن نقطة TUS لا تقبل التوكن
       الموقّع في هذا الإصدار — نعلّم الخطأ ليتم التحويل للرفع المباشر */
    const fallbackToDirect = [400, 401, 403, 404, 405, 501].includes(response.status);

    throw new UploadClientError(message, {
      status: response.status,
      retryable: !fallbackToDirect,
      fallbackToDirect,
    });
  }

  const location = response.headers.get("Location");
  if (!location) {
    throw new UploadClientError("لم تُرجع جلسة الرفع المقسّم عنوانًا صالحًا", { retryable: true });
  }

  return new URL(location, endpoint).toString();
}

async function getTusOffset(params: {
  location: string;
  signatureToken: string;
}): Promise<number> {
  const response = await fetch(params.location, {
    method: "HEAD",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "x-signature": params.signatureToken,
    },
  });

  if (!response.ok) {
    throw new UploadClientError("فشل التحقق من حالة الرفع المقسّم", {
      status: response.status,
      retryable: response.status >= 500 || response.status === 408,
    });
  }

  const offset = Number(response.headers.get("Upload-Offset") || 0);
  return Number.isFinite(offset) ? offset : 0;
}

async function patchTusChunk(params: {
  location: string;
  file: File;
  start: number;
  end: number;
  offset: number;
  signatureToken: string;
  signal: AbortSignal;
}): Promise<void> {
  const chunk = params.file.slice(params.start, params.end);

  const response = await fetch(params.location, {
    method: "PATCH",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "x-signature": params.signatureToken,
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": String(params.offset),
    },
    body: chunk,
    signal: params.signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "فشل رفع جزء من الملف");
    const isSizeLimit =
      response.status === 413 ||
      /too large|payload too large|file size/i.test(message);

    throw new UploadClientError(
      isSizeLimit
        ? "حجم الملف أكبر من الحد المسموح في إعدادات Supabase Storage حاليًا. الخطة المجانية تسمح بـ 50MB للملف — عند الترقية إلى Pro يمكن رفع الحد من إعدادات التخزين."
        : message,
      {
        status: response.status,
        retryable: [408, 429].includes(response.status) || response.status >= 500,
      }
    );
  }
}

export async function uploadResumableWithTus(params: {
  file: File;
  bucket: string;
  storagePath: string;
  contentType: string | null;
  signatureToken: string;
  sessionToken: string;
  lang: "ar" | "en";
  categoryId: string | null;
  chunkSize: number;
  onProgress: UploadProgressCallback;
  signal: AbortSignal;
}): Promise<void> {
  const {
    file,
    bucket,
    storagePath,
    contentType,
    signatureToken,
    sessionToken,
    lang,
    categoryId,
    chunkSize,
    onProgress,
    signal,
  } = params;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  if (!supabaseUrl) {
    throw new UploadClientError("NEXT_PUBLIC_SUPABASE_URL غير معرف في إعدادات الواجهة");
  }

  /* ---------- استكمال جلسة سابقة لو موجودة ---------- */
  const resumeState = loadResumeState(file);
  let location: string;
  let offset: number;

  if (resumeState && resumeState.location && resumeState.signatureToken === signatureToken) {
    try {
      offset = await getTusOffset({ location: resumeState.location, signatureToken });
      location = resumeState.location;
      console.log(`[Upload] استكمال رفع من الإزاحة ${offset} / ${file.size}`);
    } catch {
      /* الجلسة القديمة انتهت — نبدأ جلسة جديدة */
      location = await createTusSession({
        supabaseUrl,
        file,
        bucket,
        storagePath,
        contentType,
        signatureToken,
      });
      offset = 0;
    }
  } else {
    location = await createTusSession({
      supabaseUrl,
      file,
      bucket,
      storagePath,
      contentType,
      signatureToken,
    });
    offset = 0;
  }

  /* ---------- حفظ حالة الاستكمال فورًا ---------- */
  saveResumeState({
    key: fileKey(file),
    location,
    offset,
    sessionToken,
    signatureToken,
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    lang,
    categoryId,
    contentType,
    savedAt: Date.now(),
  });

  /* ---------- حلقة القطع ---------- */
  let retryIndex = 0;

  while (offset < file.size) {
    if (signal.aborted) {
      throw new UploadClientError("تم إلغاء الرفع", { status: 499 });
    }

    const end = Math.min(offset + chunkSize, file.size);

    try {
      await patchTusChunk({
        location,
        file,
        start: offset,
        end,
        offset,
        signatureToken,
        signal,
      });

      offset = end;
      retryIndex = 0;

      onProgress(
        Math.round((offset / file.size) * 100),
        offset,
        file.size
      );

      saveResumeState({
        key: fileKey(file),
        location,
        offset,
        sessionToken,
        signatureToken,
        storagePath,
        fileName: file.name,
        fileSize: file.size,
        lang,
        categoryId,
        contentType,
        savedAt: Date.now(),
      });
    } catch (error) {
      /* إلغاء المستخدم — نوقف فورًا مع الحفاظ على حالة الاستكمال */
      if (signal.aborted) {
        throw new UploadClientError("تم إلغاء الرفع", { status: 499 });
      }

      if (error instanceof UploadClientError && !error.retryable) {
        throw error;
      }

      /* انقطاع شبكة أو خطأ مؤقت — نحاول استكمال من آخر إزاحة مؤكدة */
      if (retryIndex >= MAX_CHUNK_RETRIES) {
        throw new UploadClientError(
          "تعذّر إكمال الرفع بعد عدة محاولات بسبب مشاكل الاتصال — اضغط رفع وتحليل مرة أخرى للاستكمال من حيث توقف"
        );
      }

      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
      retryIndex += 1;
      console.warn(`[Upload] قطعة فشلت — إعادة المحاولة ${retryIndex} بعد ${delay}ms`);

      await sleep(delay);

      /* مزامنة الإزاحة مع الخادم قبل إعادة المحاولة */
      try {
        offset = await getTusOffset({ location, signatureToken });
      } catch {
        /* الخادم لا يزال غير متاح — الحلقة التالية ستحاول مرة أخرى */
      }
    }
  }

  /* ---------- اكتمل الرفع ---------- */
  /* لا نمسح حالة الاستكمال هنا — تُمسح بعد نجاح complete
     حتى لو فشل complete يعيد المستخدم المحاولة بدون إعادة رفع */
}

/* =========================================================
   الخطوة 3: complete — إتمام التسجيل والتحليل على الخادم
========================================================= */

export type CompleteUploadResponse = Record<string, unknown> & {
  success?: boolean;
  error?: string;
};

export async function completeUpload(
  sessionToken: string
): Promise<{ ok: boolean; status: number; data: CompleteUploadResponse }> {
  const response = await fetch("/api/documents/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });

  const data = (await response.json().catch(() => ({}))) as CompleteUploadResponse;
  return { ok: response.ok, status: response.status, data };
}

/* =========================================================
   استكمال حلقة القطع لجلسة TUS قائمة
   (تستخدم في الاستكمال بعد إعادة تحميل الصفحة)
========================================================= */

async function continueTusUpload(params: {
  file: File;
  location: string;
  offset: number;
  signatureToken: string;
  sessionToken: string;
  lang: "ar" | "en";
  categoryId: string | null;
  chunkSize: number;
  onProgress: UploadProgressCallback;
  signal: AbortSignal;
}): Promise<void> {
  const { file, location, signatureToken, sessionToken, lang, categoryId, chunkSize, onProgress, signal } = params;
  let offset = params.offset;

  let retryIndex = 0;

  while (offset < file.size) {
    if (signal.aborted) {
      throw new UploadClientError("تم إلغاء الرفع", { status: 499 });
    }

    const end = Math.min(offset + chunkSize, file.size);

    try {
      await patchTusChunk({
        location,
        file,
        start: offset,
        end,
        offset,
        signatureToken,
        signal,
      });

      offset = end;
      retryIndex = 0;

      onProgress(Math.round((offset / file.size) * 100), offset, file.size);

      saveResumeState({
        key: fileKey(file),
        location,
        offset,
        sessionToken,
        signatureToken,
        storagePath: "",
        fileName: file.name,
        fileSize: file.size,
        lang,
        categoryId,
        contentType: file.type || null,
        savedAt: Date.now(),
      });
    } catch (error) {
      if (signal.aborted) {
        throw new UploadClientError("تم إلغاء الرفع", { status: 499 });
      }

      if (error instanceof UploadClientError && !error.retryable) {
        throw error;
      }

      if (retryIndex >= MAX_CHUNK_RETRIES) {
        throw new UploadClientError(
          "تعذّر إكمال الرفع بعد عدة محاولات بسبب مشاكل الاتصال — اضغط رفع وتحليل مرة أخرى للاستكمال من حيث توقف"
        );
      }

      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
      retryIndex += 1;
      console.warn(`[Upload] قطعة فشلت — إعادة المحاولة ${retryIndex} بعد ${delay}ms`);

      await sleep(delay);

      try {
        offset = await getTusOffset({ location, signatureToken });
      } catch {
        /* الخادم لا يزال غير متاح — الحلقة التالية ستحاول مرة أخرى */
      }
    }
  }

  /* لا نمسح حالة الاستكمال هنا — تُمسح بعد نجاح complete */
}

/* =========================================================
   الواجهة الموحدة للرفع — تستخدمها الصفحة مباشرة
========================================================= */

export async function uploadFileDirect(params: {
  file: File;
  lang: "ar" | "en";
  categoryId: string | null;
  chunkSize: number;
  onPhase: (phase: "init" | "upload" | "finalize") => void;
  onProgress: UploadProgressCallback;
  signal: AbortSignal;
}): Promise<{ status: number; data: CompleteUploadResponse }> {
  const { file, lang, categoryId, chunkSize, onPhase, onProgress, signal } = params;

  /* ---------- 0) استكمال جلسة سابقة بعد إعادة تحميل الصفحة ---------- */
  const resumeState = loadResumeState(file);

  if (resumeState && resumeState.location && resumeState.sessionToken) {
    try {
      const offset = await getTusOffset({
        location: resumeState.location,
        signatureToken: resumeState.signatureToken,
      });

      if (offset < file.size) {
        console.log(`[Upload] استكمال رفع سابق من الإزاحة ${offset} / ${file.size}`);
        onPhase("upload");
        onProgress(Math.round((offset / file.size) * 100), offset, file.size);

        await continueTusUpload({
          file,
          location: resumeState.location,
          offset,
          signatureToken: resumeState.signatureToken,
          lang: resumeState.lang,
          categoryId: resumeState.categoryId,
          sessionToken: resumeState.sessionToken,
          chunkSize,
          onProgress,
          signal,
        });

        onPhase("finalize");
        const completion = await completeUpload(resumeState.sessionToken);

        if (!completion.ok) {
          throw new UploadClientError(
            (completion.data.error as string) || "فشل إتمام معالجة الملف",
            { status: completion.status }
          );
        }

        clearResumeState();

        return { status: completion.status, data: completion.data };
      }

      /* الرفع كان قد اكتمل بالفعل — نكمل مباشرة للـ complete */
      onPhase("finalize");
      const completion = await completeUpload(resumeState.sessionToken);

      if (!completion.ok) {
        throw new UploadClientError(
          (completion.data.error as string) || "فشل إتمام معالجة الملف",
          { status: completion.status }
        );
      }

      clearResumeState();

      return { status: completion.status, data: completion.data };
    } catch (resumeError) {
      if (signal.aborted || (resumeError instanceof UploadClientError && resumeError.status === 499)) {
        throw resumeError;
      }

      /* الجلسة القديمة غير صالحة — نمسحها ونبدأ من جديد */
      console.warn("[Upload] تعذر استكمال الجلسة السابقة — بدء رفع جديد", resumeError);
      clearResumeState();
    }
  }

  /* ---------- 1) جلسة الرفع ---------- */
  onPhase("init");
  const init = await initUpload({ file, lang, categoryId });

  if (!init.mode || !init.sessionToken) {
    throw new UploadClientError(init.error || "استجابة جلسة رفع غير صالحة");
  }

  /* ---------- 2) رفع الملف مباشرة إلى Supabase ---------- */
  onPhase("upload");
  onProgress(0, 0, file.size);

  if (init.mode === "resumable" && init.signatureToken && init.bucket && init.storagePath) {
    /* ملف كبير — TUS مع استكمال تلقائي؛ ولو فشل إنشاء الجلسة
       (نقطة TUS لا تقبل التوكن الموقّع في إصدار أقدم مثلاً)
       نرجع للرفع المباشر بطلب واحد على الـ Signed URL */
    try {
      await uploadResumableWithTus({
        file,
        bucket: init.bucket,
        storagePath: init.storagePath,
        contentType: file.type || null,
        signatureToken: init.signatureToken,
        sessionToken: init.sessionToken,
        lang,
        categoryId,
        chunkSize,
        onProgress,
        signal,
      });
    } catch (error) {
      const isAbort = signal.aborted || (error instanceof UploadClientError && error.status === 499);
      if (isAbort) throw error;

      const canFallback = error instanceof UploadClientError && error.fallbackToDirect;

      if (!canFallback || !init.signedUrl) throw error;

      console.warn("[Upload] فشل رفع TUS — جاري التحويل للرفع المباشر كخطة بديلة");
      await uploadDirectToSignedUrl({ signedUrl: init.signedUrl, file, onProgress, signal });
    }
  } else if (init.signedUrl) {
    /* ملف صغير — رفع مباشر بطلب واحد */
    await uploadDirectToSignedUrl({ signedUrl: init.signedUrl, file, onProgress, signal });
  } else {
    throw new UploadClientError("استجابة جلسة الرفع لا تحتوي على رابط رفع صالح");
  }

  /* ---------- 3) إتمام التسجيل والتحليل ---------- */
  onPhase("finalize");
  const completion = await completeUpload(init.sessionToken);

  if (!completion.ok) {
    throw new UploadClientError(
      (completion.data.error as string) || "فشل إتمام معالجة الملف",
      { status: completion.status }
    );
  }

  clearResumeState();

  return { status: completion.status, data: completion.data };
}
