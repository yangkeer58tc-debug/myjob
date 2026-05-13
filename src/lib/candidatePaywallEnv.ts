/**
 * True when candidate contact paywall (staging / explicit flag) is active.
 *
 * **Production safety:** On the public site host `myjob.com` / `www.myjob.com`, the paywall is
 * **off** unless `VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION` is explicitly set. That way you can
 * merge payment code to `main` and ship other features without accidentally turning on checkout on
 * the live domain—staging / preview URLs keep working as before.
 */
export function isCandidatePaywallEnabled(): boolean {
  let hostname = '';
  try {
    const base = String(import.meta.env.VITE_SITE_URL || '').trim();
    if (base) hostname = new URL(base).hostname.toLowerCase();
  } catch {
    hostname = '';
  }

  const isPublicProdMyJob = hostname === 'myjob.com' || hostname === 'www.myjob.com';
  if (isPublicProdMyJob) {
    const allowProd = String(import.meta.env.VITE_ALLOW_CONTACT_PAYWALL_IN_PRODUCTION || '')
      .trim()
      .toLowerCase();
    return allowProd === '1' || allowProd === 'true' || allowProd === 'yes';
  }

  const raw = String(import.meta.env.VITE_ENABLE_CANDIDATE_PAYWALL || '').trim().toLowerCase();
  if (raw) return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  const siteUrl = String(import.meta.env.VITE_SITE_URL || '').toLowerCase();
  return import.meta.env.MODE === 'staging' || siteUrl.includes('staging');
}
