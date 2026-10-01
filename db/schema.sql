-- Kargo hiring schema for Neon Postgres. Identical to the original Supabase kargo_* tables;
-- rubric content is seeded by seed_rubrics.sql. Apply with `npm run db:setup`.

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

-- Original CV files (previously in Supabase Storage). Kept separate so kargo_candidates is unchanged.
create table if not exists public.kargo_cv_files (
  candidate_id uuid primary key references public.kargo_candidates(id) on delete cascade,
  filename text not null,
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

-- RLS on, no policies: the app connects as the table owner (which bypasses RLS), and anything
-- else, e.g. Neon's Data API if it is ever enabled, gets no access.
alter table public.kargo_rubrics    enable row level security;
alter table public.kargo_candidates enable row level security;
alter table public.kargo_scores     enable row level security;
alter table public.kargo_briefs     enable row level security;
alter table public.kargo_emails     enable row level security;
alter table public.kargo_events     enable row level security;
alter table public.kargo_cv_files   enable row level security;

-- Founder's-instinct layer (additive to the rubric; see db/instinct.json and docs/founders-instinct.md).
-- Qualitative signals distilled from the 8 past-hire CVs.
create table if not exists public.kargo_instinct_signals (
  key text primary key,
  position int not null,
  name text not null,
  strong text not null,
  weaker text not null,
  evidence text not null,
  confidence text not null check (confidence in ('high','moderate','tentative')),
  overlaps_rubric text
);

-- The 8 past hires as reference points: first names only, no contact details.
create table if not exists public.kargo_reference_hires (
  slug text primary key,
  position int not null,
  name text not null,
  outcome text not null check (outcome in ('exceeds','meets','below')),
  pm_score numeric not null,
  spm_score numeric not null,
  background text not null,
  standout text not null,
  signals jsonb not null
);

-- One founder's read per candidate: pattern-matching for Arjun to weigh. Never used to score,
-- recommend, or send anything.
create table if not exists public.kargo_founder_reads (
  candidate_id uuid primary key references public.kargo_candidates(id) on delete cascade,
  content jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

alter table public.kargo_instinct_signals enable row level security;
alter table public.kargo_reference_hires  enable row level security;
alter table public.kargo_founder_reads    enable row level security;
