-- ============================================================
--  AI Learning — السكيما الكاملة (تثبيت جديد من الصفر)
--  شغّل هذا الملف مرة واحدة في Supabase SQL Editor
--  لو عندك قاعدة بيانات شغالة بالفعل، شغّل 01_upgrade_v2.sql بدلاً منه
-- ============================================================

-- ============ المستخدمون والجلسات ============

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username text not null unique,
  phone text unique,
  national_id text unique,
  email text unique,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_sessions_token on auth_sessions(token_hash);
create index if not exists idx_auth_sessions_expiry on auth_sessions(expires_at);

-- ============ التصنيفات ============

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  color text not null default '#3B82F6',
  icon text,
  parent_id uuid references categories(id) on delete set null,
  sort_order int default 0,
  user_id uuid references users(id) on delete cascade,
  guest_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_categories_user on categories(user_id);
create index if not exists idx_categories_guest on categories(guest_id);

-- ============ الخطط ============

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  monthly_limit int,
  daily_limit int,
  -- حدود الدروس الجديدة: null/-1 = غير محدود، 0 = ممنوع، >0 = حد يومي
  tts_daily_limit int,
  video_daily_limit int,
  price numeric not null default 0,
  duration_days int not null default 30,
  features jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ الاشتراكات ============

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  start_date timestamptz not null default now(),
  end_date timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on subscriptions(user_id, status);

-- ============ أكواد التفعيل ============

create table if not exists activation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_id uuid not null references plans(id) on delete cascade,
  is_used boolean not null default false,
  used_by uuid references users(id) on delete set null,
  used_at timestamptz,
  -- كود مولد تلقائيًا بعد موافقة الأدمن على دفعة أول اشتراك:
  -- مربوط بمستخدم محدد + الدفعة + يوم بداية الاشتراك (يوم الدفع نفسه)
  bound_user_id uuid references users(id) on delete set null,
  payment_id uuid,
  anchor_date timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_activation_codes_plan on activation_codes(plan_id, is_used);

-- ============ المدفوعات (جديد) ============

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  amount numeric not null default 0,
  method text not null default '',
  reference text,
  -- نوع الطلب وقت التسجيل: new = أول اشتراك (التأكيد بكود تفعيل)
  -- renewal = تجديد (الموافقة بتتجدد فورًا من يوم الدفع)
  request_type text not null default 'new',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  subscription_id uuid references subscriptions(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id) on delete set null
);

create index if not exists idx_payments_user on payments(user_id, created_at desc);
create index if not exists idx_payments_status on payments(status, created_at desc);

-- ============ إعدادات التطبيق (جديد) ============

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ============ المستندات ============

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  file_path text,
  file_type text,
  media_type text not null default 'document' check (media_type in ('document', 'media')),
  file_size bigint,
  extracted_text text,
  analysis jsonb,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed', 'uploaded')),
  error_message text,
  user_id uuid references users(id) on delete cascade,
  guest_id text,
  category_id uuid references categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_user on documents(user_id, status);
create index if not exists idx_documents_guest on documents(guest_id);
create index if not exists idx_documents_hash on documents(file_hash);
create index if not exists idx_documents_category on documents(category_id);

-- ============ صور المستندات (جديد) ============

create table if not exists document_assets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  guest_id text,
  storage_path text not null,
  mime_type text,
  page_number int,
  source text not null default 'embedded' check (source in ('embedded', 'page_render', 'original')),
  analysis jsonb,
  sort_order int default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_assets_doc on document_assets(document_id, sort_order);

-- ============ الدروس الصوتية والمرئية (جديد) ============

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete set null,
  user_id uuid references users(id) on delete cascade,
  guest_id text,
  kind text not null check (kind in ('audio', 'video')),
  mode text,
  title text,
  script jsonb,
  storage_path text,
  mime_type text,
  duration_sec numeric,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lessons_user on lessons(user_id, created_at desc);
create index if not exists idx_lessons_guest on lessons(guest_id);
create index if not exists idx_lessons_document on lessons(document_id);

-- ============ سجل الاستخدام ============

create table if not exists usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  guest_id text,
  action text not null default 'document_analysis'
    check (action in ('document_analysis', 'chat', 'tts_lesson', 'video_lesson')),
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_user_action on usage(user_id, action, created_at);
create index if not exists idx_usage_guest_action on usage(guest_id, action, created_at);

-- ============ التخزين ============

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('lessons', 'lessons', false)
on conflict (id) do nothing;

-- ============ الباقات الافتراضية (تثبيت جديد فقط) ============
-- الخطة المجانية: مدى الحياة، تحليل + أسئلة، بدون دروس صوت/فيديو

insert into plans (name, description, daily_limit, monthly_limit, tts_daily_limit, video_daily_limit, price, duration_days, features)
select
  'المجانية',
  'خطة مجانية مدى الحياة — تحليل الملفات والأسئلة بشروط يومية، ومن غير دروس صوت/فيديو',
  10, 100, 0, 0, 0, 36500,
  '["تحليل 10 ملفات يومياً","100 ملف شهرياً","أسئلة ومحادثة مع الذكاء الاصطناعي","مكتبة ملفات وفولدرات","مدى الحياة بدون تفعيل"]'::jsonb
where not exists (select 1 from plans where price = 0);

-- باقة مدفوعة افتراضية (عدّل الأسعار والحدود من لوحة الأدمن)
insert into plans (name, description, daily_limit, monthly_limit, tts_daily_limit, video_daily_limit, price, duration_days, features)
select
  'الأساسية',
  'للطالب الجاد — دروس صوت وفيديو يومياً',
  50, null, 5, 3, 150, 30,
  '["تحليل 50 ملف يومياً","5 دروس صوتية يومياً","3 دروس فيديو يومياً","لهجة مصرية أو فصحى"]'::jsonb
where not exists (select 1 from plans where price > 0);

-- إعدادات الدفع الافتراضية — عدّلها من لوحة الأدمن
insert into app_settings (key, value)
values
  ('payment_methods', 'فودافون كاش — 010XXXXXXXX (عدّل الرقم من لوحة الأدمن)
إنستاباي — 010XXXXXXXX (عدّل الرقم من لوحة الأدمن)
تحويل بنكي — اسم البنك ورقم الحساب (عدّل من لوحة الأدمن)')
on conflict (key) do nothing;

-- الموافقة التلقائية أتلغت نهائيًا — كل الدفعات بتستنى مراجعة الأدمن
delete from app_settings where key = 'payments_auto_approve';

-- ============ الأمان ============
-- التطبيق يتصل بـ Supabase دائمًا بمفتاح service role من الخادم،
-- وتتجاوز مفاتيح الـ service role قيود RLS،
-- لذا نفعّل RLS بدون سياسات عامة لمنع أي وصول مباشر من المتصفح بالمفتاح العام.

alter table users enable row level security;
alter table auth_sessions enable row level security;
alter table categories enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table activation_codes enable row level security;
alter table payments enable row level security;
alter table app_settings enable row level security;
alter table documents enable row level security;
alter table document_assets enable row level security;
alter table lessons enable row level security;
alter table usage enable row level security;
