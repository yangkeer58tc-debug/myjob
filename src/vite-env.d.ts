/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  /** WhatsApp Business MSISDN for apply/contact links (digits only). Overrides staging/production defaults when set. */
  readonly VITE_WHATSAPP_BOT_NUMBER?: string;
  /** POST endpoint for job summary/highlights JSON `{ description, jd }` → `{ summary, highlights[] }`. */
  readonly VITE_JOB_AI_URL?: string;
  /** Optional Bearer token for `VITE_JOB_AI_URL`. */
  readonly VITE_JOB_AI_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_API_BASE_URL?: string;
  readonly VITE_OPENAI_MODEL?: string;
  /** Injected at build time from `LLM_*` process env (see vite.config). */
  readonly LLM_API_KEY?: string;
  readonly LLM_BASE_URL?: string;
  readonly LLM_MODEL?: string;
  /** Parallel AI calls during CSV job import (default 6, max 20). */
  readonly VITE_JOB_IMPORT_AI_CONCURRENCY?: string;
  /** Parallel Supabase upserts when AI is off (default 15, max 30). */
  readonly VITE_JOB_IMPORT_UPSERT_CONCURRENCY?: string;
  /** Candidate contact unlock price in MXN for staging payment wall. */
  readonly VITE_CANDIDATE_CONTACT_PRICE_MXN?: string;
  /** Enable candidate paywall regardless of mode when set to true/1. */
  readonly VITE_ENABLE_CANDIDATE_PAYWALL?: string;
  /**
   * Master switch: allow candidate paywall on production host myjob.com. Omit or false = paywall
   * never shows on live domain even if other flags are mis-set.
   */
  readonly VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION?: string;
  /** Enable admin resumes module in /admin when true/1. */
  readonly VITE_ENABLE_RESUME_ADMIN?: string;
}
