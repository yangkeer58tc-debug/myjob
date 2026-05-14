-- Aggregated stats for the admin WhatsApp bot dashboard (PV/UV + funnel).
-- UV = COUNT(DISTINCT digits-only wa_user_id) on inbound messages.

CREATE OR REPLACE FUNCTION public.whatsapp_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'total', (SELECT count(*)::bigint FROM whatsapp_conversations),
      'awaiting_resume', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state IN ('awaiting_resume', 'awaiting_name')
      ),
      'awaiting_returning_cv', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state = 'awaiting_returning_cv_choice'
      ),
      'awaiting_opt_in', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state = 'awaiting_opt_in'
      ),
      'completed_no_cv', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state = 'completed_no_cv'
      ),
      'resume_received', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE last_resume_storage_path IS NOT NULL OR resume_storage_path IS NOT NULL
      ),
      'opted_in', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state = 'completed_opt_in'
      ),
      'declined', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE state = 'completed_declined'
      ),
      'rmc_success', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE rmc_sync_status = 'success'
      ),
      'rmc_failed', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE rmc_sync_status = 'failed'
      ),
      'rmc_skipped', (
        SELECT count(*)::bigint FROM whatsapp_conversations
        WHERE rmc_sync_status IN ('skipped_no_config', 'skipped_staging')
      )
    ),
    'inbound_pv_uv', jsonb_build_object(
      'h24', jsonb_build_object(
        'pv', (
          SELECT count(*)::bigint FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '24 hours')
        ),
        'uv', (
          SELECT count(DISTINCT NULLIF(regexp_replace(wa_user_id, '\D', '', 'g'), ''))::bigint
          FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '24 hours')
        )
      ),
      'd7', jsonb_build_object(
        'pv', (
          SELECT count(*)::bigint FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '7 days')
        ),
        'uv', (
          SELECT count(DISTINCT NULLIF(regexp_replace(wa_user_id, '\D', '', 'g'), ''))::bigint
          FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '7 days')
        )
      ),
      'd30', jsonb_build_object(
        'pv', (
          SELECT count(*)::bigint FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '30 days')
        ),
        'uv', (
          SELECT count(DISTINCT NULLIF(regexp_replace(wa_user_id, '\D', '', 'g'), ''))::bigint
          FROM whatsapp_messages
          WHERE direction = 'inbound' AND created_at >= (now() - interval '30 days')
        )
      ),
      'all', jsonb_build_object(
        'pv', (
          SELECT count(*)::bigint FROM whatsapp_messages
          WHERE direction = 'inbound'
        ),
        'uv', (
          SELECT count(DISTINCT NULLIF(regexp_replace(wa_user_id, '\D', '', 'g'), ''))::bigint
          FROM whatsapp_messages
          WHERE direction = 'inbound'
        )
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.whatsapp_admin_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_admin_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public.whatsapp_admin_dashboard_stats() IS
  'Admin dashboard: funnel counts over all conversations; inbound PV/UV (UV = distinct digit-only phone) for 24h/7d/30d/all.';
