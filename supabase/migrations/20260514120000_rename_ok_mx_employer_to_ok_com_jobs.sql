-- Rename MX real-feed employer display name (was ok.com招聘, now OK.com Jobs)

UPDATE public.jobs
SET b_name = 'OK.com Jobs'
WHERE external_source = 'ok_mx_real'
  AND b_name = 'ok.com招聘';

UPDATE public.whatsapp_applications
SET job_company = 'OK.com Jobs'
WHERE job_company = 'ok.com招聘'
  AND job_id IN (SELECT id FROM public.jobs WHERE external_source = 'ok_mx_real');

UPDATE public.whatsapp_conversations
SET applying_job_company = 'OK.com Jobs'
WHERE applying_job_company = 'ok.com招聘'
  AND applying_job_id IN (SELECT id FROM public.jobs WHERE external_source = 'ok_mx_real');
