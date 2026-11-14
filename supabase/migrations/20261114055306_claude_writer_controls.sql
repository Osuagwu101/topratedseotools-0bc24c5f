-- Claude writer quotas; callers are authenticated by server functions.
create table if not exists public.claude_user_controls (
 user_id uuid primary key references auth.users(id) on delete cascade,
 daily_message_limit integer not null default 25 check(daily_message_limit between 0 and 10000),
 updated_at timestamptz not null default now()
);
create table if not exists public.claude_daily_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 usage_date date not null,
 messages_used integer not null default 0 check(messages_used>=0),
 primary key(user_id,usage_date)
);
create table if not exists public.claude_message_reservations (
 user_id uuid not null references auth.users(id) on delete cascade,
 message_key text not null check(length(message_key)=64),
 usage_date date not null,
 status text not null default 'reserved' check(status in ('reserved','released')),
 created_at timestamptz not null default now(),
 primary key(user_id,message_key)
);
alter table public.claude_user_controls enable row level security;
alter table public.claude_daily_usage enable row level security;
alter table public.claude_message_reservations enable row level security;
revoke all on public.claude_user_controls,public.claude_daily_usage,public.claude_message_reservations from public,anon,authenticated;
grant select,insert,update on public.claude_user_controls,public.claude_daily_usage,public.claude_message_reservations to service_role;
create or replace function public.reserve_claude_message(p_user_id uuid,p_message_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d date := (now() at time zone 'Africa/Lagos')::date; lim integer; used integer; inserted integer;
begin
 if length(p_message_key)<>64 then raise exception 'Invalid message key'; end if;
 insert into public.claude_user_controls(user_id) values(p_user_id) on conflict do nothing;
 select daily_message_limit into lim from public.claude_user_controls where user_id=p_user_id for update;
 insert into public.claude_daily_usage(user_id,usage_date) values(p_user_id,d) on conflict do nothing;
 select messages_used into used from public.claude_daily_usage where user_id=p_user_id and usage_date=d;
 if exists(select 1 from public.claude_message_reservations where user_id=p_user_id and message_key=p_message_key) then
  return jsonb_build_object('allowed',false,'code','duplicate','limit',lim,'used',used,'remaining',greatest(0,lim-used));
 end if;
 if used>=lim then
  return jsonb_build_object('allowed',false,'code','daily_limit','limit',lim,'used',used,'remaining',0);
 end if;
 insert into public.claude_message_reservations(user_id,message_key,usage_date) values(p_user_id,p_message_key,d) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted<>1 then return jsonb_build_object('allowed',false,'code','duplicate'); end if;
 update public.claude_daily_usage set messages_used=messages_used+1 where user_id=p_user_id and usage_date=d;
 return jsonb_build_object('allowed',true,'limit',lim,'used',used+1,'remaining',greatest(0,lim-used-1));
end $$;
create or replace function public.release_claude_message(p_user_id uuid,p_message_key text)
returns void language plpgsql security invoker set search_path='' as $$
declare d date; changed integer;
begin
 perform 1 from public.claude_user_controls where user_id=p_user_id for update;
 update public.claude_message_reservations set status='released' where user_id=p_user_id and message_key=p_message_key and status='reserved' returning usage_date into d;
 get diagnostics changed=row_count;
 if changed=1 then
  update public.claude_daily_usage set messages_used=greatest(0,messages_used-1) where user_id=p_user_id and usage_date=d;
 end if;
end $$;
revoke all on function public.reserve_claude_message(uuid,text),public.release_claude_message(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_claude_message(uuid,text),public.release_claude_message(uuid,text) to service_role;
