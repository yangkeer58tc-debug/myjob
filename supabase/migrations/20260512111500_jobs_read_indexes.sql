-- Reduce high Disk IO caused by repeated sequential scans on public.jobs.
-- Evidence from production:
-- - jobs only had the primary key index
-- - frequent queries filter by is_active and sort by created_at
-- - related jobs and SEO pages filter by location/category
-- - job detail may resolve by slug

create index if not exists idx_jobs_created_at
  on public.jobs using btree (created_at desc);

create index if not exists idx_jobs_active_created_at
  on public.jobs using btree (created_at desc)
  where is_active = true;

create index if not exists idx_jobs_active_location_created_at
  on public.jobs using btree (location, created_at desc)
  where is_active = true;

create index if not exists idx_jobs_active_category_created_at
  on public.jobs using btree (category, created_at desc)
  where is_active = true;

create index if not exists idx_jobs_slug
  on public.jobs using btree (slug);

analyze public.jobs;
