-- Kargo hiring schema (applied to Supabase project mesa-ai-track as migration "kargo_hiring_schema").
-- Rubric content is seeded by seed_rubrics.sql.

create table if not exists public.kargo_rubrics (
  role text primary key check (role in ('PM','SPM')),
  title text not null,
  threshold numeric not null,
  lower_tier_below numeric,
  criteria jsonb not null,               -- [{key,name,weight,guidance}]
  scale jsonb not null,
  notes text,
  updated_at timestamptz not null default now()
);

-- PII (name/email/phone) lives ONLY in these columns and is never sent to the LLM.
create table if not exists public.kargo_candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  applied_role text not null check (applied_role in ('PM','SPM')),
  full_name text,
  email text,
  phone text,
  cv_filename text,
  cv_storage_path text,
  redacted_text text,
  extracted jsonb,
  status text not null default 'processing' check (status in ('processing','ready','error')),
  error text,
  decision text not null default 'pending' check (decision in ('pending','invite','reject','hold')),
  pm_score numeric,
  spm_score numeric,
  applied_score numeric,
  recommendation text check (recommendation in ('invite','reject')),
  arjun_notes text
);
create index if not exists kargo_candidates_applied_score_idx on public.kargo_candidates (applied_score desc nulls last);

create table if not exists public.kargo_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.kargo_candidates(id) on delete cascade,
  role text not null check (role in ('PM','SPM')),
  total numeric not null,
  criteria jsonb not null,
  summary text,
  model text,
  created_at timestamptz not null default now(),
  unique (candidate_id, role)
);

create table if not exists public.kargo_briefs (
  candidate_id uuid primary key references public.kargo_candidates(id) on delete cascade,
  content jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.kargo_emails (
  candidate_id uuid primary key references public.kargo_candidates(id) on delete cascade,
  kind text not null check (kind in ('invite','reject')),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  resend_id text,
  sent_at timestamptz,
  sent_to text,
  error text,
  model text,
  updated_at timestamptz not null default now()
);

create table if not exists public.kargo_events (
  id bigint generated always as identity primary key,
  candidate_id uuid references public.kargo_candidates(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  detail jsonb
);
create index if not exists kargo_events_candidate_idx on public.kargo_events (candidate_id, at);

-- RLS on, no policies: only the server's secret key can read or write.
alter table public.kargo_rubrics    enable row level security;
alter table public.kargo_candidates enable row level security;
alter table public.kargo_scores     enable row level security;
alter table public.kargo_briefs     enable row level security;
alter table public.kargo_emails     enable row level security;
alter table public.kargo_events     enable row level security;

insert into storage.buckets (id, name, public) values ('kargo-cvs', 'kargo-cvs', false)
on conflict (id) do nothing;
