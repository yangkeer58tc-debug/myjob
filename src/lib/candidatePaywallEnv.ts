/** True when candidate contact paywall (staging / explicit flag) is active. */
export function isCandidatePaywallEnabled(): boolean {
  const raw = String(import.meta.env.VITE_ENABLE_CANDIDATE_PAYWALL || '').trim().toLowerCase();
  if (raw) return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  const siteUrl = String(import.meta.env.VITE_SITE_URL || '').toLowerCase();
  return import.meta.env.MODE === 'staging' || siteUrl.includes('staging');
}
