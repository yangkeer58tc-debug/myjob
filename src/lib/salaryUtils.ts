const parseSalaryNumber = (input: string) => {
  const raw = input.trim().replace(/\u00A0/g, ' ');
  if (!raw) return null;
  if (/[A-Za-z]/.test(raw)) return null;

  const cleaned = raw
    .replace(/(brl|mxn|r\$|mx\$|\$)/gi, '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    normalized = cleaned.replace(/,/g, '.');
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 3 && cleaned.length > 4) normalized = cleaned.replace(/\./g, '');
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;

  const hasDecimals = normalized.includes('.') && !Number.isInteger(num);
  return { num, hasDecimals };
};

export const salaryNumberForSchema = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = parseSalaryNumber(String(value));
  return parsed ? parsed.num : null;
};

export const formatSalaryBRL = (value: string | null | undefined) => {
  if (!value) return '';
  const parsed = parseSalaryNumber(String(value));
  if (!parsed) return String(value);

  const formatted = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: parsed.hasDecimals ? 2 : 0,
    maximumFractionDigits: parsed.hasDecimals ? 2 : 0,
  }).format(parsed.num);

  return `R$ ${formatted}`;
};

export const formatSalaryMXN = (value: string | null | undefined) => {
  if (!value) return '';
  const parsed = parseSalaryNumber(String(value));
  if (!parsed) return String(value);

  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: parsed.hasDecimals ? 2 : 0,
    maximumFractionDigits: parsed.hasDecimals ? 2 : 0,
  }).format(parsed.num);
};
