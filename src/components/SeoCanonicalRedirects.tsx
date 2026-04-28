import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Old or mistaken pattern myjob.com/employ/{id}/ → canonical /empleo/{id}/
 * (301 in public/_redirects when the host applies it; client fallback for dev / edge cases.)
 */
export function EmployToEmpleoRedirect() {
  const { id = '' } = useParams();
  const { search, hash } = useLocation();
  const clean = String(id || '').replace(/\/+$/, '');
  if (!clean) return <Navigate to={`/empleos${search}${hash}`} replace />;
  return <Navigate to={`/empleo/${clean}/${search}${hash}`} replace />;
}

/**
 * Mistaken job URLs under /empleos/{slug}/ (listing is /empleos with query only).
 * Maps to single canonical job path /empleo/{slug}/ to fix "Duplicate without user-selected canonical."
 */
export function EmpleosPrefixJobRedirect() {
  const { jobSlug = '' } = useParams();
  const { search, hash } = useLocation();
  const clean = String(jobSlug || '').replace(/^\/+|\/+$/g, '');
  if (!clean) return <Navigate to={`/empleos${search}${hash}`} replace />;
  return <Navigate to={`/empleo/${clean}/${search}${hash}`} replace />;
}
