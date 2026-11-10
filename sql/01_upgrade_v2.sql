-- ============================================================
--  AI Learning — ترقية قاعدة البيانات الموجودة (الإصدار 2)
--  شغّل هذا الملف في Supabase SQL Editor مرة واحدة
--  (يضيف جداول الصور والدروس + حقول الباقات + buckets)
--  آمن للتشغيل على قاعدة بيانات بها بيانات — لا يحذف أي شيء
-- ============================================================

-- ============ 1) جدول صور المستندات ============

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

-- ============ 2) جدول الدروس الصوتية والمرئية ============

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

-- ============ 3) حقول حدود الدروس في الباقات ============
-- null أو -1 = غير محدود | 0 = ممنوع | >0 = حد يومي

alter table plans add column if not exists tts_daily_limit int;
alter table plans add column if not exists video_daily_limit int;

-- ============ 4) توسيع قيمة عمود action في جدول usage ============
-- الجداول القديمة كانت تسمح فقط ببعض القيم — نضيف القيم الجديدة
-- (لو الـ constraint الأصلي مختلف الاسم عدّل الاسم حسب قاعدة بياناتك)

do $$
begin
  -- نحاول حذف الـ constraint القديم إن وُجد بأي اسم شائع
  begin
    alter table usage drop constraint if exists usage_action_check;
  exception when others then null;
  end;

  begin
    alter table usage drop constraint if exists usage_action_check1;
  exception when others then null;
  end;

  -- نضيف الـ constraint الجديد الشامل
  begin
    alter table usage add constraint usage_action_check
      check (action in ('document_analysis', 'chat', 'tts_lesson', 'video_lesson', 'analysis'));
  exception when duplicate_object then null;
  end;
end $$;

-- ============ 5) bucket الدروس ============

insert into storage.buckets (id, name, public)
values ('lessons', 'lessons', false)
on conflict (id) do nothing;

-- bucket documents موجود بالفعل، لكن نتأكد منه
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ============ 6) فهارس مفيدة إن لم تكن موجودة ============

create index if not exists idx_documents_user on documents(user_id, status);
create index if not exists idx_documents_hash on documents(file_hash);
create index if not exists idx_usage_user_action on usage(user_id, action, created_at);
create index if not exists idx_usage_guest_action on usage(guest_id, action, created_at);
create index if not exists idx_auth_sessions_token on auth_sessions(token_hash);

-- ============ 7) أكواد التفعيل (إن لم يكن الجدول موجودًا) ============
-- لو كنت شغّلت 00_full_schema.sql من قبل فالجدول موجود وأمر التشغيل ده هيتجاوزه بأمان

create table if not exists activation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_id uuid not null references plans(id) on delete cascade,
  is_used boolean not null default false,
  used_by uuid references users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_activation_codes_plan on activation_codes(plan_id, is_used);

alter table activation_codes enable row level security;

-- ============ 8) قاعدة الباقات المجانية: بدون توليد دروس ============
-- قرار تصميمي: توليد الدروس الصوتية/المرئية للباقات المدفوعة فقط
-- (0 = ممنوع · null أو -1 = غير محدود · >0 = حد يومي)

update plans
set tts_daily_limit = 0, video_daily_limit = 0
where price = 0;

-- الباقات المدفوعة اللي لسه من غير تحديد؟ نسيبها null = غير محدود —
-- الأدمن يقدر يضبط الحد اليومي من صفحة إدارة الباقات لو عايز يحسب الاستخدام

-- ============ تم ✅ ============
-- بعد التشغيل: أعد تشغيل التطبيق وستعمل الميزات الجديدة مباشرة
