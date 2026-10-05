-- Turnitin Phase 5: Originality Reports adapter support.
-- Isolated to Turnitin tables, the generic encrypted session vault, and
-- two private Turnitin storage buckets. No existing checkout/tool flow changes.

begin;

-- Allow the shared encrypted vault to store the Turnitin/Originality session.
alter table public.tool_authorized_sessions
  drop constraint if exists tool_authorized_sessions_supported_tools;

alter table public.tool_authorized_sessions
  add constraint tool_authorized_sessions_supported_tools
  check (tool_slug in ('stealthwriter', 'phrasly', 'chatgpt', 'turnitin'));

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
