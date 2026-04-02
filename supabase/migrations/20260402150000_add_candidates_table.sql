CREATE TABLE public.candidates (
  id text PRIMARY KEY,
  role_slug text NOT NULL,
  full_name text,
  age integer,
  location text,
  headline text,
  summary text,
  experience text,
  education_level text,
  employment_type text,
  salary_expectation text,
  availability text,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true
);

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Candidates are publicly readable" ON public.candidates
  FOR SELECT USING (is_public = true);

CREATE POLICY "Authenticated users can insert candidates" ON public.candidates
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update candidates" ON public.candidates
  FOR UPDATE TO authenticated USING (true);

