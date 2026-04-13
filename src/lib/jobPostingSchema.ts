/**
 * Helpers for Google JobPosting JSON-LD (description HTML, employer URL, confirmed salary only).
 */

import { isPlaceholderSalaryText, salaryNumberForSchema } from '@/lib/salaryUtils';

/** Escape text embedded inside HTML for JSON-LD description. */
export function escapeHtmlForJsonLd(value: string): string {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Google recommends HTML in description with at least <p>, <br>, or newlines.
 * We emit safe <p> blocks and <br> for single newlines within a block.
 */
export function jobPostingDescriptionHtml(plain: string): string {
  const trimmed = String(plain || '').trim();
  if (!trimmed) return '<p></p>';
  const blocks = trimmed.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return '<p></p>';
  return blocks
    .map((block) => {
      const escaped = escapeHtmlForJsonLd(block).replace(/\n/g, '<br>\n');
      return `<p>${escaped}</p>`;
    })
    .join('\n');
}

/** Normalize employer homepage for schema.org sameAs (https preferred). */
export function normalizeEmployerSameAs(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.protocol === 'http:') {
      u.protocol = 'https:';
    }
    u.hash = '';
    return u.href.replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

export function paymentFrequencyToSalaryUnitText(paymentFrequency: string): string {
  const f = String(paymentFrequency || '').trim();
  if (f === 'mensal') return 'MONTH';
  if (f === 'quinzenal') return 'WEEK';
  if (f === 'semanal') return 'WEEK';
  if (f === 'hora') return 'HOUR';
  if (f === 'diario') return 'DAY';
  return 'OTHER';
}

/** Only include baseSalary when DB has a parseable, non-placeholder amount (Google: actual employer salary). */
export function schemaBaseSalaryFromJob(job: {
  salary_amount: string | null | undefined;
  payment_frequency: string | null | undefined;
}): {
  baseSalary: {
    '@type': 'MonetaryAmount';
    currency: string;
    value: { '@type': 'QuantitativeValue'; value: number; unitText: string };
  };
} | null {
  if (isPlaceholderSalaryText(job.salary_amount)) return null;
  const value = salaryNumberForSchema(job.salary_amount);
  if (value === null) return null;
  const unitText = paymentFrequencyToSalaryUnitText(String(job.payment_frequency ?? 'mensal'));
  return {
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'MXN',
      value: {
        '@type': 'QuantitativeValue',
        value,
        unitText,
      },
    },
  };
}
