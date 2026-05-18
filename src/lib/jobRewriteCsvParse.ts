import Papa from 'papaparse';

const JOB_CSV_PARSE_BASE = { skipEmptyLines: true as const };
const JOB_CSV_DELIMITERS = [',', '\t', ';', '|'] as const;

export function fatalPapaParseErrors(errors: Array<{ message?: string; code?: string }> | undefined) {
  if (!errors?.length) return [];
  return errors.filter((e) => {
    const code = String(e.code ?? '');
    const msg = String(e.message ?? '');
    if (code === 'UndetectableDelimiter') return false;
    if (msg.includes('Unable to auto-detect delimiting character')) return false;
    return true;
  });
}

export function parseJobCsvText(text: string): Papa.ParseResult<Record<string, string>> {
  let best: Papa.ParseResult<Record<string, string>> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const delimiter of JOB_CSV_DELIMITERS) {
    const parsed = Papa.parse<Record<string, string>>(text, { ...JOB_CSV_PARSE_BASE, header: true, delimiter });
    const fatal = fatalPapaParseErrors(parsed.errors);
    const fields = (parsed.meta?.fields || []).filter((f) => String(f ?? '').trim() !== '');
    const nonEmptyRows = (parsed.data || []).filter((r) =>
      Object.values(r || {}).some((v) => String(v ?? '').trim() !== ''),
    );
    const score = fields.length * 100 + nonEmptyRows.length - fatal.length * 10000;
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
  }

  return best || Papa.parse<Record<string, string>>(text, { ...JOB_CSV_PARSE_BASE, header: true, delimiter: ',' });
}
