#!/usr/bin/env node

const isTruthy = (value) => {
  const s = String(value || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
};

const enabled = isTruthy(process.env.VITE_ENABLE_RESUME_ADMIN);
if (!enabled) {
  console.log("[resume-admin-check] feature flag disabled; skip resumes env checks.");
  process.exit(0);
}

const required = ["VITE_RESUMES_SUPABASE_URL", "VITE_RESUMES_SUPABASE_ANON_KEY"];
const missing = required.filter((key) => !String(process.env[key] || "").trim());

if (missing.length) {
  console.error("[resume-admin-check] feature enabled but required env vars are missing:");
  for (const key of missing) console.error(`- ${key}`);
  process.exit(2);
}

console.log("[resume-admin-check] OK: resumes admin feature env is ready.");
process.exit(0);

