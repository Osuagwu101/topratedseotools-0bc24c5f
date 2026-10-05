-- Turnitin Phase 5: Originality Reports adapter support.
-- Isolated to Turnitin tables, the generic encrypted session vault, and
-- two private Turnitin storage buckets. No existing checkout/tool flow changes.

begin;

-- Dedicated server-only Originality Reports session vault.
-- Turnitin intentionally does NOT alter or share the existing
-- StealthWriter/Phrasly/ChatGPT authorised-session table.
create table if not exists public.turnitin_originality_authorized_session (
  id text primary key default 'primary'
    check (id = 'primary'),
  encrypted_payload text not null,
  session_format text not null default 'originality_cookie_json',
  status text not null default 'stored'
    check (status in ('stored', 'revoked')),
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.turnitin_originality_authorized_session enable row level security;

revoke all on table public.turnitin_originality_authorized_session from anon;
revoke all on table public.turnitin_originality_authorized_session from authenticated;
grant all on table public.turnitin_originality_authorized_session to service_role;

drop trigger if exists trg_turnitin_originality_authorized_session_updated
  on public.turnitin_originality_authorized_session;
create trigger trg_turnitin_originality_authorized_session_updated
  before update on public.turnitin_originality_authorized_session
  for each row execute function public.tg_touch_updated_at();

comment on table public.turnitin_originality_authorized_session is
  'Turnitin-only server-side encrypted Originality Reports authorised session; never exposed to anon/authenticated clients.';

comment on column public.turnitin_originality_authorized_session.encrypted_payload is
  'AES-GCM encrypted Originality Reports session state; never returned to customers or Admin after saving.';

-- Adapter retry/sync metadata. The provider's upload_token is deliberately
-- persisted so retries cannot accidentally create/charge a second submission.
alter table public.turnitin_jobs
  add column if not exists upstream_upload_token text null,
  add column if not exists upstream_last_checked_at timestamptz null,
  add column if not exists upstream_sync_attempts integer not null default 0
    check (upstream_sync_attempts >= 0),
  add column if not exists upstream_last_error text null;

create unique index if not exists turnitin_jobs_upload_token_uidx
  on public.turnitin_jobs (upstream_upload_token)
  where upstream_upload_token is not null;

-- Private source-document bucket. Customers upload only through short-lived
-- signed-upload tokens produced by the Turnitin server function.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'turnitin-source',
  'turnitin-source',
  false,
  104857600,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Private report bucket. Similarity/AI PDFs are downloaded by the backend and
-- exposed to the owning customer only through short-lived signed URLs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'turnitin-reports',
  'turnitin-reports',
  false,
  104857600,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally no direct authenticated storage.objects policies are added.
-- Source upload uses a signed-upload token; all report writes/reads use the
-- service-role server path and signed download links.

comment on column public.turnitin_jobs.upstream_upload_token is
  'Stable Originality Reports upload_token reused across retries for idempotency.';
comment on column public.turnitin_jobs.upstream_last_checked_at is
  'Most recent successful/attempted upstream status sync time.';
comment on column public.turnitin_jobs.upstream_sync_attempts is
  'Count of status-sync attempts for operational visibility.';
comment on column public.turnitin_jobs.upstream_last_error is
  'Last upstream adapter error; contains no credentials/session state.';

commit;
