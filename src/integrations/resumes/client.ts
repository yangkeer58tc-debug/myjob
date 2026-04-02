import { createClient } from '@supabase/supabase-js';

const RESUMES_SUPABASE_URL = import.meta.env.VITE_RESUMES_SUPABASE_URL;
const RESUMES_SUPABASE_ANON_KEY = import.meta.env.VITE_RESUMES_SUPABASE_ANON_KEY;

export const resumesSupabase =
  RESUMES_SUPABASE_URL && RESUMES_SUPABASE_ANON_KEY
    ? createClient(RESUMES_SUPABASE_URL, RESUMES_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export const getResumesSource = () => {
  const tableOrView = (import.meta.env.VITE_RESUMES_PUBLIC_VIEW || 'public_candidates').trim() || 'public_candidates';
  return { tableOrView };
};

