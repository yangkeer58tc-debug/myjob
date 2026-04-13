/**
 * Conservative MXN monthly anchors when JD does not mention pay (Mexico, 2026-ish).
 * Tuned by coarse category + city cost-of-living multiplier — not official statistics.
 */

const CATEGORY_BASE_MXN: Record<string, number> = {
  'healthcare-medical': 12500,
  'call-center-customer-service': 9500,
  sales: 10500,
  'mfg-transport-logistics': 11200,
  'trades-services': 9800,
};

const TITLE_HINTS: Array<{ re: RegExp; add: number }> = [
  { re: /supervisor|supervis[oó]r|coordinador|gerente|manager/i, add: 3500 },
  { re: /ingenier|engineer|desarroll|developer|programador/i, add: 4000 },
  { re: /director|jefe\s+de/i, add: 7000 },
];

const CITY_MULT: Array<{ re: RegExp; mult: number }> = [
  { re: /ciudad de m[eé]xico|cdmx|mexico city/i, mult: 1.12 },
  { re: /monterrey|guadalajara/i, mult: 1.08 },
  { re: /quer[eé]taro|puebla|tijuana|le[oó]n|m[eé]rida/i, mult: 1.04 },
];

export function estimatedMonthlyMxnForJob(
  categoryId: string | null | undefined,
  title: string,
  locationLabel: string,
): { salary_amount: string; payment_frequency: 'mensal' } {
  let base = CATEGORY_BASE_MXN[categoryId || ''] ?? 10000;
  const t = title || '';
  for (const { re, add } of TITLE_HINTS) {
    if (re.test(t)) base += add;
  }
  let mult = 1;
  const loc = locationLabel || '';
  for (const { re, mult: m } of CITY_MULT) {
    if (re.test(loc)) {
      mult = m;
      break;
    }
  }
  const n = Math.round((base * mult) / 100) * 100;
  const clamped = Math.min(85000, Math.max(7500, n));
  return { salary_amount: String(clamped), payment_frequency: 'mensal' };
}
