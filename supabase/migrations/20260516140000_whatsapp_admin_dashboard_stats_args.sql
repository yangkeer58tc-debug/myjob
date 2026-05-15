-- Replace zero-arg stats RPC with a version that accepts optional time bounds for
-- the primary `range` PV/UV bucket (rolling h24/d7/d30/all unchanged).

DROP FUNCTION IF EXISTS public.whatsapp_admin_dashboard_stats();
DROP FUNCTION IF EXISTS public.whatsapp_admin_dashboard_stats(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.whatsapp_admin_dashboard_stats(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
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
      'range', jsonb_build_object(
        'pv', (
          SELECT count(*)::bigint FROM whatsapp_messages
          WHERE direction = 'inbound'
            AND (p_from IS NULL OR created_at >= p_from)
            AND (p_to IS NULL OR created_at <= p_to)
        ),
        'uv', (
          SELECT count(DISTINCT NULLIF(regexp_replace(wa_user_id, '\D', '', 'g'), ''))::bigint
          FROM whatsapp_messages
          WHERE direction = 'inbound'
            AND (p_from IS NULL OR created_at >= p_from)
            AND (p_to IS NULL OR created_at <= p_to)
        )
      ),
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

REVOKE ALL ON FUNCTION public.whatsapp_admin_dashboard_stats(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_admin_dashboard_stats(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_admin_dashboard_stats(timestamptz, timestamptz) IS
  'Admin dashboard: all-time funnel; inbound PV/UV with optional [p_from,p_to] on messages.created_at in `range`; rolling h24/d7/d30/all.';
