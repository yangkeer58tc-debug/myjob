-- Admin: daily funnel (Asia/Shanghai calendar) + WhatsApp-number–aggregated user directory.

DROP FUNCTION IF EXISTS public.whatsapp_admin_funnel_daily_cn(date, date);
CREATE OR REPLACE FUNCTION public.whatsapp_admin_funnel_daily_cn(p_from date, p_to date)
RETURNS TABLE (
  day_cn date,
  session_uv bigint,
  resume_pv bigint,
  application_pv bigint,
  exposure_opt_in_pv bigint,
  exposure_opt_in_uv bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH days AS (
    SELECT d::date AS d
    FROM generate_series(p_from, p_to, '1 day'::interval) AS s(d)
  )
  SELECT
    days.d AS day_cn,
    (
      SELECT count(DISTINCT NULLIF(regexp_replace(m.wa_user_id, '\D', '', 'g'), ''))::bigint
      FROM public.whatsapp_messages m
      WHERE (timezone('Asia/Shanghai', m.created_at))::date = days.d
        AND NULLIF(regexp_replace(m.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
    ) AS session_uv,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_messages m
      WHERE (timezone('Asia/Shanghai', m.created_at))::date = days.d
        AND m.direction = 'inbound'
        AND m.media_url IS NOT NULL
        AND m.message_type = ANY (ARRAY['document'::text, 'image'::text, 'video'::text])
    ) AS resume_pv,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_applications a
      WHERE (timezone('Asia/Shanghai', a.created_at))::date = days.d
        AND a.job_id IS NOT NULL
    ) AS application_pv,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_applications a
      WHERE (timezone('Asia/Shanghai', a.created_at))::date = days.d
        AND a.opt_in_status = 'opted_in'
    ) AS exposure_opt_in_pv,
    (
      SELECT count(DISTINCT NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), ''))::bigint
      FROM public.whatsapp_applications a
      WHERE (timezone('Asia/Shanghai', a.created_at))::date = days.d
        AND a.opt_in_status = 'opted_in'
        AND NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
    ) AS exposure_opt_in_uv
  FROM days
  ORDER BY days.d DESC;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_admin_funnel_daily_cn(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_admin_funnel_daily_cn(date, date) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_admin_funnel_daily_cn IS
  'Admin funnel by China calendar day: session_uv=distinct WA digits with any message; resume_pv=inbound file messages; application_pv=applications with job_id; exposure opt-in PV/UV from whatsapp_applications opted_in.';

DROP FUNCTION IF EXISTS public.whatsapp_admin_wa_directory_cn(text, integer, integer);
CREATE OR REPLACE FUNCTION public.whatsapp_admin_wa_directory_cn(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH conv AS (
    SELECT
      c.id,
      c.wa_user_id,
      NULLIF(regexp_replace(c.wa_user_id, '\D', '', 'g'), '') AS phone_key,
      c.state,
      c.candidate_name,
      c.last_message_at,
      c.applying_job_title,
      c.applying_job_company,
      c.archived_at
    FROM public.whatsapp_conversations c
    WHERE NULLIF(regexp_replace(c.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
  ),
  latest AS (
    SELECT DISTINCT ON (phone_key)
      id AS latest_conversation_id,
      phone_key,
      wa_user_id AS wa_display,
      state AS last_state,
      candidate_name,
      last_message_at,
      applying_job_title,
      applying_job_company
    FROM conv
    ORDER BY phone_key, last_message_at DESC NULLS LAST, id DESC
  ),
  agg AS (
    SELECT
      phone_key,
      count(*)::bigint AS conversation_row_count,
      max(last_message_at) AS last_active_at
    FROM conv
    GROUP BY phone_key
  ),
  resume_cnt AS (
    SELECT
      NULLIF(regexp_replace(c.wa_user_id, '\D', '', 'g'), '') AS phone_key,
      count(*)::bigint AS resume_send_count
    FROM public.whatsapp_messages m
    INNER JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
    WHERE m.direction = 'inbound'
      AND m.media_url IS NOT NULL
      AND m.message_type = ANY (ARRAY['document'::text, 'image'::text, 'video'::text])
    GROUP BY 1
    HAVING NULLIF(regexp_replace(c.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
  ),
  app_cnt AS (
    SELECT
      NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') AS phone_key,
      count(*)::bigint AS application_count
    FROM public.whatsapp_applications a
    WHERE a.job_id IS NOT NULL
    GROUP BY 1
    HAVING NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
  ),
  opted AS (
    SELECT DISTINCT NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') AS phone_key
    FROM public.whatsapp_applications a
    WHERE a.opt_in_status = 'opted_in'
      AND NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
  ),
  merged AS (
    SELECT
      l.latest_conversation_id,
      l.phone_key,
      l.wa_display,
      l.candidate_name,
      l.last_state,
      l.last_message_at,
      l.applying_job_title,
      l.applying_job_company,
      a.conversation_row_count,
      a.last_active_at,
      coalesce(r.resume_send_count, 0)::bigint AS resume_send_count,
      coalesce(p.application_count, 0)::bigint AS application_count,
      EXISTS (SELECT 1 FROM opted o WHERE o.phone_key = l.phone_key) AS has_opted_in_exposure
    FROM latest l
    INNER JOIN agg a ON a.phone_key = l.phone_key
    LEFT JOIN resume_cnt r ON r.phone_key = l.phone_key
    LEFT JOIN app_cnt p ON p.phone_key = l.phone_key
  ),
  filtered AS (
    SELECT *
    FROM merged m
    WHERE length(trim(coalesce(p_search, ''))) = 0
       OR m.phone_key ILIKE ('%' || trim(p_search) || '%')
       OR m.wa_display ILIKE ('%' || trim(p_search) || '%')
       OR coalesce(m.candidate_name, '') ILIKE ('%' || trim(p_search) || '%')
       OR coalesce(m.applying_job_title, '') ILIKE ('%' || trim(p_search) || '%')
       OR coalesce(m.applying_job_company, '') ILIKE ('%' || trim(p_search) || '%')
  ),
  total AS (
    SELECT count(*)::bigint AS c FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY last_active_at DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
    OFFSET greatest(0, coalesce(p_offset, 0))
  )
  SELECT jsonb_build_object(
    'total', (SELECT c FROM total),
    'rows', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'latest_conversation_id', x.latest_conversation_id,
            'phone_key', x.phone_key,
            'wa_display', x.wa_display,
            'candidate_name', x.candidate_name,
            'last_state', x.last_state,
            'last_message_at', x.last_message_at,
            'applying_job_title', x.applying_job_title,
            'applying_job_company', x.applying_job_company,
            'conversation_row_count', x.conversation_row_count,
            'resume_send_count', x.resume_send_count,
            'application_count', x.application_count,
            'has_opted_in_exposure', x.has_opted_in_exposure
          )
          ORDER BY x.last_active_at DESC NULLS LAST
        )
        FROM paged x
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.whatsapp_admin_wa_directory_cn(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_admin_wa_directory_cn(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_admin_wa_directory_cn IS
  'Admin: one logical row per WhatsApp number (digit-normalized), latest conversation snapshot + counts.';
