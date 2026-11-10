-- ============================================================
--  AI Learning — ترقية تدفق الدفع: مراجعة الأدمن إلزامية (v2.3)
--  شغّل هذا الملف مرة واحدة في Supabase SQL Editor
--  (لو مركّب من الصفر، 00_full_schema.sql شامل كل حاجة بالفعل)
--
--  بعمل إيه؟
--  1) إلغاء الموافقة التلقائية نهائيًا — مينفعش المستخدم يتفعل لوحده:
--     كل دفعة بتستنى مراجعة الأدمن من لوحة (أدمن → المدفوعات)
--  2) نوع الطلب على كل دفعة:
--     new = أول اشتراك → بعد الموافقة يتولد كود تفعيل مربوط بالمستخدم،
--           الأدمن يبعته له، والمستخدم يدخله في صفحة الباقات
--     renewal = تجديد → أول ما الأدمن يوافق يتجدد فورًا من غير أي كود
--  3) الاشتراك بيتحسب من يوم ما المستخدم أكد الدفع (بعت الرقم المرجعي)
--     مش من يوم موافقة الأدمن — فالأدمن لو اتأخر يوم المستخدم مبيخسرش يوم
--  4) كود التفعيل المولد إلكترونيًا بيبقى مربوط بمستخدم محدد
--     (مش بيشتغل مع حد تاني) وبيحمل يوم بداية الاشتراك
-- ============================================================

-- ============ 1) نوع الطلب على جدول المدفوعات ============

alter table payments
  add column if not exists request_type text not null default 'new';

-- ============ 2) أعمدة الكود المولد تلقائيًا ============

alter table activation_codes
  add column if not exists bound_user_id uuid references users(id) on delete set null;
alter table activation_codes
  add column if not exists payment_id uuid;
alter table activation_codes
  add column if not exists anchor_date timestamptz;

create index if not exists idx_activation_codes_bound
  on activation_codes(bound_user_id);

-- ============ 3) إلغاء الموافقة التلقائية نهائيًا ============

delete from app_settings where key = 'payments_auto_approve';

-- الدفعات المعلقة القديمة (لو فيها): تفضل pending عادية — الأدمن يراجعها من اللوحة،
-- وبيتم التعامل معها كأول اشتراك (new) افتراضيًا
