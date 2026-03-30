-- Create the jobs table
CREATE TABLE public.jobs (
  id text PRIMARY KEY,
  b_name text NOT NULL,
  b_logo_url text,
  title text NOT NULL,
  slug text,
  category text,
  salary_amount text NOT NULL,
  payment_frequency text NOT NULL,
  location text NOT NULL,
  job_type text NOT NULL,
  workplace_type text NOT NULL,
  summary text,
  description text,
  requirements text,
  highlights text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Jobs are publicly readable" ON public.jobs
  FOR SELECT USING (true);

-- Authenticated users can insert/update (admin)
CREATE POLICY "Authenticated users can insert jobs" ON public.jobs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update jobs" ON public.jobs
  FOR UPDATE TO authenticated USING (true);

-- Auto-generate slug from title on insert
CREATE OR REPLACE FUNCTION public.generate_job_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(
      regexp_replace(NEW.title, '[^a-zA-Z0-9áéíóúñü\s-]', '', 'g'),
      '\s+', '-', 'g'
    ));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trigger_generate_job_slug
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_job_slug();