-- Add English translation fields and IMC SOP fields to jobs table
ALTER TABLE public.jobs
  ADD COLUMN title_en text,
  ADD COLUMN description_en text,
  ADD COLUMN summary_en text,
  ADD COLUMN requirements_en text,
  ADD COLUMN highlights_en text[],
  ADD COLUMN education_level text,
  ADD COLUMN industry text,
  ADD COLUMN language_req text,
  ADD COLUMN experience text;
