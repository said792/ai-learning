-- ============================================================
--  AI Learning — ترقية نظام الاشتراكات والدفع (v2.2)
--  شغّل هذا الملف مرة واحدة في Supabase SQL Editor
--  (لو مركّب من الصفر، 00_full_schema.sql شامل كل حاجة بالفعل)
--
--  بعمل إيه؟
--  1) جدول المدفوعات payments + إعدادات التطبيق app_settings
--  2) الخطة المجانية: مدى الحياة (سنة × 100) + دروس صوت/فيديو = 0
--  3) كل مستخدم من غير اشتراك ساري بياخد الخطة المجانية تلقائيًا
--  4) الاشتراكات المجانية القديمة (30 يوم) تتحول لمدى الحياة
-- ============================================================

-- ============ 1) جدول المدفوعات ============

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  amount numeric not null default 0,
  method text not null default '',
  reference text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  subscription_id uuid references subscriptions(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id) on delete set null
);

create index if not exists idx_payments_user on payments(user_id, created_at desc);
create index if not exists idx_payments_status on payments(status, created_at desc);

-- ============ 2) إعدادات التطبيق (طرق الدفع + الموافقة التلقائية) ============

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values
  ('payment_methods', 'فودافون كاش — 010XXXXXXXX (عدّل الرقم من لوحة الأدمن)
إنستاباي — 010XXXXXXXX (عدّل الرقم من لوحة الأدمن)
تحويل بنكي — اسم البنك ورقم الحساب (عدّل من لوحة الأدمن)'),
  ('payments_auto_approve', 'true')
on conflict (key) do nothing;

-- ============ 3) الخطة المجانية — مدى الحياة ============

-- لو مفيش خطة مجانية (سعرها 0) → نعملها
insert into plans (name, description, daily_limit, monthly_limit, tts_daily_limit, video_daily_limit, price, duration_days, features)
select
  'المجانية',
  'خطة مجانية مدى الحياة — تحليل الملفات والأسئلة بشروط يومية، ومن غير دروس صوت/فيديو',
  10,      -- ملفات/يوم (عدّلها من لوحة الأدمن)
  100,     -- ملفات/شهر
  0,       -- دروس صوتية: غير متاحة
  0,       -- دروس فيديو: غير متاحة
  0,
  36500,   -- مدى الحياة (100 سنة)
  '["تحليل 10 ملفات يومياً","100 ملف شهرياً","أسئلة ومحادثة مع الذكاء الاصطناعي","مكتبة ملفات وفولدرات","مدى الحياة بدون تفعيل"]'::jsonb
where not exists (
  select 1 from plans where price = 0
);

-- لو فيه خطة مجانية موجودة: مداها مدى الحياة ودروس الصوت/الفيديو ممنوعة
update plans
set duration_days = 36500,
    tts_daily_limit = 0,
    video_daily_limit = 0
where price = 0;

-- ============ 4) الاشتراكات المجانية القديمة → مدى الحياة ============

-- أي اشتراك ساري على الخطة المجانية: نخلي نهايته بعد 100 سنة
update subscriptions s
set end_date = now() + interval '100 years'
from plans p
where p.id = s.plan_id
  and p.price = 0
  and s.status = 'active'
  and s.end_date < now() + interval '50 years';

-- ============ 5) كل مستخدم من غير اشتراك ساري → اشتراك مجاني مدى الحياة ============

insert into subscriptions (user_id, plan_id, start_date, end_date, status)
select u.id, fp.id, now(), now() + interval '100 years', 'active'
from users u
cross join (select id from plans where price = 0 limit 1) fp
where not exists (
  select 1 from subscriptions s
  where s.user_id = u.id
    and s.status = 'active'
    and s.end_date > now()
);

-- ============ 6) الأمان (RLS) — زي باقي الجداول ============

alter table payments enable row level security;
alter table app_settings enable row level security;
