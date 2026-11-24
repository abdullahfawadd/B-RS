create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null default '',
  display_name text not null default '',
  rpo_hours integer not null default 24 check (rpo_hours between 1 and 8760),
  rto_seconds integer not null default 60 check (rto_seconds between 1 and 86400),
  created_at timestamptz not null default now()
);
create table public.backup_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  storage_path text not null unique,
  status text not null default 'active' check (status in ('active','deleting','deleted')),
  auto_test boolean not null default true,
  encryption_enabled boolean not null default false,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  check (storage_path = user_id::text || '/' || id::text)
);
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  user_id uuid not null,
  original_filename text not null,
  relative_path text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size between 0 and 50000000),
  mime_type text not null default 'application/octet-stream',
  sha256_checksum text check (sha256_checksum ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','ready')),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (source_id,user_id) references public.backup_sources(id,user_id) on delete cascade,
  unique(source_id,relative_path),
  check (storage_path = user_id::text || '/' || source_id::text || '/' || id::text),
  check (status <> 'ready' or (sha256_checksum is not null and uploaded_at is not null))
);
create table public.backup_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid not null,
  frequency text not null check (frequency in ('daily','weekly')),
  scheduled_time time not null,
  timezone text not null,
  weekday integer not null default 1 check (weekday between 0 and 6),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (source_id,user_id) references public.backup_sources(id,user_id) on delete cascade
);
create table public.backup_jobs (
  id uuid primary key,
  user_id uuid not null,
  source_id uuid not null,
  status text not null check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (source_id,user_id) references public.backup_sources(id,user_id) on delete cascade,
  unique (id,user_id)
);
create table public.backups (
  id uuid primary key,
  user_id uuid not null,
  source_id uuid not null,
  backup_job_id uuid not null unique,
  name text not null,
  archive_path text not null unique,
  original_size bigint not null check (original_size >= 0),
  compressed_size bigint not null check (compressed_size > 0),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null,
  encryption_enabled boolean not null default false,
  encryption_version integer,
  status text not null default 'pending' check (status in ('pending','verified','corrupted','missing','failed','deleting','deleted')),
  verified_at timestamptz,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  demo_corrupt boolean not null default false,
  foreign key (source_id,user_id) references public.backup_sources(id,user_id) on delete cascade,
  foreign key (backup_job_id,user_id) references public.backup_jobs(id,user_id) on delete cascade,
  unique(id,user_id),
  check (archive_path = user_id::text || '/' || id::text || '/archive.bin'),
  check ((encryption_enabled and encryption_version is not null) or (not encryption_enabled and encryption_version is null))
);
create table public.restore_operations (
  id uuid primary key,
  user_id uuid not null,
  backup_id uuid not null,
  restore_destination text not null unique,
  status text not null check (status in ('running','success','failed')),
  files_restored integer not null default 0,
  bytes_restored bigint not null default 0,
  duration_ms integer,
  restore_duration_ms integer,
  verification_duration_ms integer,
  output_files jsonb not null default '[]',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (backup_id,user_id) references public.backups(id,user_id) on delete cascade,
  check (restore_destination = user_id::text || '/' || id::text)
);
create table public.restore_tests (
  id uuid primary key,
  user_id uuid not null,
  backup_id uuid not null,
  status text not null check (status in ('running','passed','partially_passed','failed','cancelled')),
  trigger text not null default 'manual' check (trigger in ('manual','automatic','demo')),
  files_tested integer not null default 0,
  files_verified integer not null default 0,
  failed_files integer not null default 0,
  bytes_restored bigint not null default 0,
  duration_ms integer,
  restore_duration_ms integer,
  verification_duration_ms integer,
  verification_details jsonb not null default '[]',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (backup_id,user_id) references public.backups(id,user_id) on delete cascade
);
create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  retention_configuration jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (source_id,user_id) references public.backup_sources(id,user_id) on delete cascade,
  unique (source_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  operation text not null,
  resource_type text not null,
  resource_id uuid,
  status text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.workspace_leases (
  user_id uuid primary key references auth.users on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);

create index sources_owner_idx on public.backup_sources(user_id,created_at desc);
create index files_owner_idx on public.source_files(user_id,source_id);
create index schedules_owner_idx on public.backup_schedules(user_id);
create index schedules_due_idx on public.backup_schedules(next_run_at) where enabled;
create index jobs_owner_idx on public.backup_jobs(user_id,created_at desc);
create index jobs_source_idx on public.backup_jobs(source_id,user_id);
create index backups_owner_idx on public.backups(user_id,created_at desc);
create index backups_source_idx on public.backups(source_id,user_id,created_at desc);
create index restores_owner_idx on public.restore_operations(user_id,started_at desc);
create index restores_backup_idx on public.restore_operations(backup_id,user_id);
create index tests_owner_idx on public.restore_tests(user_id,started_at desc);
create index tests_backup_idx on public.restore_tests(backup_id,user_id);
create index retention_owner_idx on public.retention_policies(user_id);
create index audit_owner_idx on public.audit_logs(user_id,created_at desc);

do $policies$
declare
  rel text;
  owner_column text;
begin
  foreach rel in array array['profiles','backup_sources','source_files','backup_schedules','backup_jobs',
    'backups','restore_operations','restore_tests','retention_policies','audit_logs','workspace_leases']
  loop
    owner_column := case when rel = 'profiles' then 'id' else 'user_id' end;
    execute format('alter table public.%I enable row level security', rel);
    execute format('revoke all on table public.%I from public, anon, authenticated', rel);
    execute format('grant select, insert, update, delete on table public.%I to service_role', rel);
    if rel <> 'workspace_leases' then
      execute format('grant select on table public.%I to authenticated', rel);
      execute format('create policy owner_read on public.%I for select to authenticated using (%I = (select auth.uid()))', rel, owner_column);
    end if;
  end loop;
end
$policies$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('source-files','source-files',false,50000000),
       ('backup-archives','backup-archives',false,50000000),
       ('restored-files','restored-files',false,50000000);

create policy workspace_objects_read on storage.objects for select to authenticated
using (bucket_id in ('source-files','backup-archives','restored-files') and
       (storage.foldername(name))[1] = (select auth.uid()::text));

create function public.acquire_workspace_lease(p_user uuid, p_token uuid) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.workspace_leases (user_id, token, expires_at)
    values (p_user, p_token, now() + interval '150 seconds')
    on conflict (user_id) do update
    set token = excluded.token, expires_at = excluded.expires_at
    where public.workspace_leases.expires_at < now();
  return found;
end;
$$;

create function public.finish_backup(p_user uuid, p_id uuid, p_backup jsonb, p_duration integer) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.backup_jobs;
begin
  update public.backup_jobs set status = 'success', completed_at = now(), duration_ms = p_duration
    where id = p_id and user_id = p_user and status = 'running' returning * into job;
  if not found then
    raise exception 'Backup job is not running';
  end if;
  insert into public.backups (
    id, user_id, source_id, backup_job_id, name, archive_path, original_size, compressed_size, checksum,
    manifest, encryption_enabled, encryption_version, status, verified_at, demo_corrupt
  ) values (
    p_id, p_user, job.source_id, p_id, p_backup->>'name', p_backup->>'archive_path',
    (p_backup->>'original_size')::bigint,(p_backup->>'compressed_size')::bigint,p_backup->>'checksum',
    p_backup->'manifest',(p_backup->>'encryption_enabled')::boolean,(p_backup->>'encryption_version')::integer,
    p_backup->>'status',case when p_backup->>'status' = 'verified' then now() end,
    coalesce((p_backup->>'demo_corrupt')::boolean,false)
  );
  insert into public.audit_logs(user_id,operation,resource_type,resource_id,status,details)
    values (p_user,case when p_backup->>'demo_corrupt' = 'true' then 'demo_corrupt' else 'backup' end,
      'backup',p_id,'success',jsonb_build_object('archive_bytes',p_backup->'compressed_size','integrity',p_backup->>'status'));
end;
$$;

revoke all on function public.acquire_workspace_lease(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_backup(uuid,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.acquire_workspace_lease(uuid,uuid) to service_role;
grant execute on function public.finish_backup(uuid,uuid,jsonb,integer) to service_role;
