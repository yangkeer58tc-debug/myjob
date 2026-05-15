-- Admin: single-row summary for funnel date range (Asia/Shanghai calendar), with correct period-level UV.

DROP FUNCTION IF EXISTS public.whatsapp_admin_funnel_range_summary_cn(date, date);
CREATE OR REPLACE FUNCTION public.whatsapp_admin_funnel_range_summary_cn(p_from date, p_to date)
RETURNS TABLE (
  day_count bigint,
  session_uv_period bigint,
  resume_pv bigint,
  application_pv bigint,
  exposure_opt_in_pv bigint,
  exposure_opt_in_uv_period bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT least(p_from, p_to) AS d0, greatest(p_from, p_to) AS d1
  )
  SELECT
    (SELECT (r.d1 - r.d0 + 1)::bigint FROM r) AS day_count,
    (
      SELECT count(DISTINCT NULLIF(regexp_replace(m.wa_user_id, '\D', '', 'g'), ''))::bigint
      FROM public.whatsapp_messages m, r
      WHERE (timezone('Asia/Shanghai', m.created_at))::date BETWEEN r.d0 AND r.d1
        AND NULLIF(regexp_replace(m.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
    ) AS session_uv_period,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_messages m, r
      WHERE (timezone('Asia/Shanghai', m.created_at))::date BETWEEN r.d0 AND r.d1
        AND m.direction = 'inbound'
        AND m.media_url IS NOT NULL
        AND m.message_type = ANY (ARRAY['document'::text, 'image'::text, 'video'::text])
    ) AS resume_pv,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_applications a, r
      WHERE (timezone('Asia/Shanghai', a.created_at))::date BETWEEN r.d0 AND r.d1
        AND a.job_id IS NOT NULL
    ) AS application_pv,
    (
      SELECT count(*)::bigint
      FROM public.whatsapp_applications a, r
      WHERE (timezone('Asia/Shanghai', a.created_at))::date BETWEEN r.d0 AND r.d1
        AND a.opt_in_status = 'opted_in'
    ) AS exposure_opt_in_pv,
    (
      SELECT count(DISTINCT NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), ''))::bigint
      FROM public.whatsapp_applications a, r
      WHERE (timezone('Asia/Shanghai', a.created_at))::date BETWEEN r.d0 AND r.d1
        AND a.opt_in_status = 'opted_in'
        AND NULLIF(regexp_replace(a.wa_user_id, '\D', '', 'g'), '') IS NOT NULL
    ) AS exposure_opt_in_uv_period;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_admin_funnel_range_summary_cn(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_admin_funnel_range_summary_cn(date, date) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_admin_funnel_range_summary_cn IS
  'Admin: one row summarizing funnel metrics over inclusive China calendar days d0..d1 (same definitions as whatsapp_admin_funnel_daily_cn; UV columns are period-distinct).';
