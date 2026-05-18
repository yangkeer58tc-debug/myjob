-- Async AI job rewrite queue (Plan A)

create table if not exists public.job_rewrite_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'cancelled', 'failed')),
  total_count int not null default 0,
  pending_count int not null default 0,
  saved_count int not null default 0,
  failed_count int not null default 0,
  source_filename text,
  llm_model text,
  error_summary text
);

create table if not exists public.job_rewrite_tasks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.job_rewrite_batches (id) on delete cascade,
  row_index int not null,
  job_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  input jsonb not null,
  row_snapshot jsonb not null,
  result jsonb,
  error text,
  attempts smallint not null default 0,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_index)
);

create index if not exists idx_job_rewrite_tasks_batch_status
  on public.job_rewrite_tasks (batch_id, status, row_index);

create index if not exists idx_job_rewrite_tasks_processing_lock
  on public.job_rewrite_tasks (status, locked_at)
  where status = 'processing';

alter table public.job_rewrite_batches
  add column if not exists updated_at timestamptz not null default now();

alter table public.job_rewrite_batches enable row level security;
alter table public.job_rewrite_tasks enable row level security;

create policy job_rewrite_batches_select_own
  on public.job_rewrite_batches for select to authenticated
  using (created_by = auth.uid());

create policy job_rewrite_batches_insert_own
  on public.job_rewrite_batches for insert to authenticated
  with check (created_by = auth.uid());

create policy job_rewrite_batches_update_own
  on public.job_rewrite_batches for update to authenticated
  using (created_by = auth.uid());

create policy job_rewrite_tasks_select_own_batch
  on public.job_rewrite_tasks for select to authenticated
  using (
    exists (
      select 1 from public.job_rewrite_batches b
      where b.id = batch_id and b.created_by = auth.uid()
    )
  );

create policy job_rewrite_tasks_insert_own_batch
  on public.job_rewrite_tasks for insert to authenticated
  with check (
    exists (
      select 1 from public.job_rewrite_batches b
      where b.id = batch_id and b.created_by = auth.uid()
    )
  );

-- Release stale processing locks
create or replace function public.release_stale_job_rewrite_tasks(p_timeout_minutes int default 15)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.job_rewrite_tasks
  set
    status = 'pending',
    locked_at = null,
    locked_by = null,
    updated_at = now()
  where status = 'processing'
    and locked_at is not null
    and locked_at < now() - make_interval(mins => greatest(p_timeout_minutes, 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.claim_job_rewrite_tasks(p_limit int, p_worker text)
returns setof public.job_rewrite_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select t.id
    from public.job_rewrite_tasks t
    inner join public.job_rewrite_batches b on b.id = t.batch_id
    where t.status = 'pending'
      and b.status in ('queued', 'running')
      and t.attempts < 6
    order by t.created_at, t.row_index
    limit greatest(1, least(coalesce(p_limit, 4), 12))
    for update of t skip locked
  )
  update public.job_rewrite_tasks t
  set
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker,
    attempts = t.attempts + 1,
    updated_at = now()
  from picked
  where t.id = picked.id
  returning t.*;
end;
$$;

create or replace function public.refresh_job_rewrite_batch_stats(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_done int;
  v_failed int;
  v_skipped int;
  v_processing int;
  v_total int;
  v_status text;
begin
  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'done'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'skipped'),
    count(*) filter (where status = 'processing'),
    count(*)
  into v_pending, v_done, v_failed, v_skipped, v_processing, v_total
  from public.job_rewrite_tasks
  where batch_id = p_batch_id;

  select status into v_status from public.job_rewrite_batches where id = p_batch_id;

  if v_status = 'cancelled' then
    return;
  end if;

  if v_pending = 0 and v_processing = 0 then
    if v_failed > 0 and v_done = 0 then
      v_status := 'failed';
    else
      v_status := 'completed';
    end if;
  elsif v_done > 0 or v_processing > 0 or v_failed > 0 then
    v_status := 'running';
  else
    v_status := 'queued';
  end if;

  update public.job_rewrite_batches
  set
    pending_count = v_pending,
    saved_count = v_done,
    failed_count = v_failed,
    total_count = v_total,
    status = v_status,
    updated_at = now()
  where id = p_batch_id;
end;
$$;

revoke all on function public.claim_job_rewrite_tasks(int, text) from public;
revoke all on function public.release_stale_job_rewrite_tasks(int) from public;
revoke all on function public.refresh_job_rewrite_batch_stats(uuid) from public;
grant execute on function public.claim_job_rewrite_tasks(int, text) to service_role;
grant execute on function public.release_stale_job_rewrite_tasks(int) to service_role;
grant execute on function public.refresh_job_rewrite_batch_stats(uuid) to service_role;
