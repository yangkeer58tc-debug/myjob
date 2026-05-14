import { describe, expect, it } from 'vitest';
import { canonicalSiteCategory } from '../../supabase/functions/whatsapp-webhook/jobRecommendCanonical';
import {
  OK_COM_JOBS_B_NAME,
  formatJobCardBody,
  pickNextRecommendedJob,
  scoreJobAgainstAnchor,
  sortJobsForRecommendation,
  type JobRecRow,
} from '../../supabase/functions/whatsapp-webhook/jobRecommend';
import { extractViewJobIdFromButtonText } from '../../supabase/functions/whatsapp-webhook/parsing';

const baseJob = (over: Partial<JobRecRow>): JobRecRow => ({
  id: over.id ?? 'j1',
  slug: over.slug ?? null,
  title: over.title ?? 'Dev',
  b_name: over.b_name ?? 'Other Co',
  location: over.location ?? 'Monterrey',
  salary_amount: over.salary_amount ?? '15000',
  payment_frequency: over.payment_frequency ?? 'mensual',
  job_type: over.job_type ?? 'Tiempo completo',
  workplace_type: over.workplace_type ?? 'Presencial',
  category: over.category ?? null,
  mx_category_code: over.mx_category_code ?? null,
  summary: over.summary ?? null,
  industry: over.industry ?? null,
  experience: over.experience ?? null,
  education_level: over.education_level ?? null,
  is_active: over.is_active ?? true,
  created_at: over.created_at ?? '2026-01-01T00:00:00Z',
});

describe('scoreJobAgainstAnchor', () => {
  const anchor = baseJob({
    id: 'a1',
    title: 'Enfermera clínica',
    category: 'healthcare-medical',
    industry: 'Salud',
    location: 'Guadalajara',
    mx_category_code: 'MX-01',
  });

  it('scores higher when category and industry match', () => {
    const jMatch = baseJob({
      id: 'x1',
      category: 'healthcare-medical',
      industry: 'Salud',
      location: 'Guadalajara',
    });
    const jMiss = baseJob({
      id: 'x2',
      category: 'call-center-customer-service',
      industry: 'Retail',
      location: 'CDMX',
    });
    expect(scoreJobAgainstAnchor(jMatch, anchor)).toBeGreaterThan(scoreJobAgainstAnchor(jMiss, anchor));
  });

  it('gives partial credit when OK MX-style industry overlaps plain text', () => {
    const okAnchor = baseJob({
      id: 'a2',
      title: 'Agente telefónico',
      category: 'call-center-customer-service',
      industry: 'MX · Call center',
      location: 'Monterrey',
    });
    const imcJob = baseJob({
      id: 'x3',
      category: 'sales',
      industry: 'Call center representative bilingual',
      location: 'Monterrey',
    });
    expect(scoreJobAgainstAnchor(imcJob, okAnchor)).toBeGreaterThan(0);
  });
});

describe('canonicalSiteCategory (OK mx_code ↔ IMC category)', () => {
  it('maps OK leaf cate_code via CSV-derived map', () => {
    const ok = baseJob({
      category: null,
      mx_category_code: 'nursing-community-health',
      industry: 'MX · Enfermería',
      title: 'Auxiliar',
    });
    expect(canonicalSiteCategory(ok)).toBe('healthcare-medical');
  });

  it('scores cross-feed when canonical buckets match', () => {
    const anchor = baseJob({
      id: 'a',
      category: null,
      mx_category_code: 'customer-service-call-center',
      industry: 'MX · Atención',
      title: 'Agente',
    });
    const imc = baseJob({
      id: 'x',
      category: 'call-center-customer-service',
      mx_category_code: null,
      title: 'Otro',
    });
    expect(scoreJobAgainstAnchor(imc, anchor)).toBeGreaterThanOrEqual(90);
  });
});

describe('OK.com Jobs priority', () => {
  it('sorts OK.com Jobs before other companies at equal relevance', () => {
    const anchor = baseJob({ id: 'a', title: 'X', category: 'c1', industry: 'Ind', location: 'L' });
    const ok = baseJob({
      id: 'ok1',
      b_name: OK_COM_JOBS_B_NAME,
      category: 'c2',
      industry: 'Other',
      location: 'M',
      created_at: '2026-01-02T00:00:00Z',
    });
    const other = baseJob({
      id: 'o1',
      b_name: 'Acme SA',
      category: 'c2',
      industry: 'Other',
      location: 'M',
      created_at: '2026-01-03T00:00:00Z',
    });
    const sorted = sortJobsForRecommendation([other, ok], anchor);
    expect(sorted[0]!.id).toBe('ok1');
  });
});

describe('pickNextRecommendedJob', () => {
  it('skips excluded ids', () => {
    const anchor = baseJob({ id: 'a', category: 'cat', industry: 'Ind', location: 'Loc' });
    const j1 = baseJob({ id: 'x1', category: 'cat', industry: 'Ind', location: 'Loc' });
    const j2 = baseJob({ id: 'x2', category: 'cat', industry: 'Ind', location: 'Loc', created_at: '2025-01-01T00:00:00Z' });
    const picked = pickNextRecommendedJob([j1, j2], anchor, new Set(['x1']));
    expect(picked?.id).toBe('x2');
  });
});

describe('formatJobCardBody', () => {
  it('shows OK·com instead of OK.com in employer line', () => {
    const j = baseJob({ b_name: 'OK.com Jobs', title: 'Chef', industry: 'MX · Restaurantes' });
    const body = formatJobCardBody(j);
    expect(body).toContain('OK·com');
    expect(body).not.toContain('OK.com');
  });

  it('omits slug-like industry blobs', () => {
    const j = baseJob({ industry: 'customer-service-call-center-ops-and-more-slug' });
    const body = formatJobCardBody(j);
    expect(body).not.toContain('customer-service-call-center');
  });
});

describe('extractViewJobIdFromButtonText', () => {
  it('parses WA_VIEW_JOB prefix', () => {
    expect(extractViewJobIdFromButtonText('WA_VIEW_JOB:uuid-here')).toBe('uuid-here');
  });
});
