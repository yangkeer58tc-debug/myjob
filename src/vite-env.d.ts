/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
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
}
