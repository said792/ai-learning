/* =========================================================
   إعدادات خط الرفع المباشر — كل القيم هنا قابلة للتغيير
   من متغيرات البيئة بدون تعديل الكود (جاهز للانتقال إلى Pro)
========================================================= */

/** الباكت المستخدم في Supabase Storage (نفس الباكت الحالي) */
export const STORAGE_BUCKET = "documents";

/** البادئة التي تُحفظ فيها الملفات قبل اكتمال معالجتها */
export const PENDING_PATH_PREFIX = "pending";

/**
 * الحد الأقصى لحجم الملف الذي يُرفع بطلب واحد مباشر (Signed URL POST).
 * الملفات الأكبر من هذا الحد ترفع عبر TUS (رفع مقسّم قابل للاستكمال).
 *
 * لاحظ: هذا حد تقني لطريقة النقل فقط وليس حدًا مفروضًا على المستخدم —
 * أي حجم أكبر يتم تحويله تلقائيًا لطريقة TUS، وليس رفضه.
 */
export const DIRECT_UPLOAD_MAX_MB = Number(process.env.UPLOAD_DIRECT_MAX_MB ?? 25);

/**
 * حجم القطعة (Chunk) في رفع TUS — 6MB كما توصي Supabase رسميًا.
 * القطع تذهب مباشرة من المتصفح إلى Supabase ولا تمر عبر Vercel،
 * لذلك لا تتأثر بحد 4.5MB الخاص بـ Vercel.
 */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * صلاحية توكين جلسة الرفع بالثواني (HMAC) — يجب أن تكون ضمن
 * صلاحية Signed Upload URL من Supabase (ساعتان).
 */
export const UPLOAD_SESSION_TTL_SECONDS = 2 * 60 * 60;

/** حد حجم الكائنات المهملة في مجلد pending قبل حذفها تلقائيًا */
export const PENDING_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** احتمالية تشغيل التنظيف التلقائي في كل طلب init (لتخفيف الحمل) */
export const PENDING_CLEANUP_PROBABILITY = 0.05;

/** قراءة متغير بيئة مع رسالة واضحة عند غيابه */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`متغير البيئة ${name} مفقود — أضفه في إعدادات المشروع على Vercel`);
  }
  return value;
}
