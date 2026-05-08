-- WhatsApp bot v3: extend conversation schema for opt-in / RMC sync / archive,
-- and grant authenticated users read access for the Admin dashboard.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------
-- 1. New conversation columns
------------------------------------------------------------

alter table public.whatsapp_conversations
  add column if not exists opt_in_clarify_count integer not null default 0,
  add column if not exists rmc_resume_id uuid,
  add column if not exists rmc_sync_status text not null default 'none',
  add column if not exists rmc_sync_error text,
  add column if not exists last_resume_storage_path text,
  add column if not exists last_resume_received_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_rmc_sync_status_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_rmc_sync_status_check
  check (rmc_sync_status in ('none','pending','success','failed','skipped_no_config','skipped_staging'));

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_state_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_state_check
  check (state in (
    'new',
    'awaiting_name',
    'awaiting_resume',
    'awaiting_opt_in',
    'completed_opt_in',
    'completed_declined'
  ));

------------------------------------------------------------
-- 2. wa_user_id is no longer globally unique: a user can have multiple
--    archived conversations and one active row. Enforce uniqueness only
--    while archived_at IS NULL.
------------------------------------------------------------

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_wa_user_id_key;

create unique index if not exists idx_whatsapp_conversations_active_user
  on public.whatsapp_conversations(wa_user_id)
  where archived_at is null;

create index if not exists idx_whatsapp_conversations_archived
  on public.whatsapp_conversations(archived_at);

create index if not exists idx_whatsapp_conversations_completed
  on public.whatsapp_conversations(completed_at);

------------------------------------------------------------
-- 3. Allow authenticated (admin-logged-in) users to read history.
--    Writes still happen via service_role from the Edge Function.
------------------------------------------------------------

drop policy if exists "whatsapp_conversations_authenticated_select" on public.whatsapp_conversations;
create policy "whatsapp_conversations_authenticated_select"
  on public.whatsapp_conversations
  for select
  to authenticated
  using (true);

drop policy if exists "whatsapp_messages_authenticated_select" on public.whatsapp_messages;
create policy "whatsapp_messages_authenticated_select"
  on public.whatsapp_messages
  for select
  to authenticated
  using (true);

grant select on public.whatsapp_conversations to authenticated;
grant select on public.whatsapp_messages to authenticated;
