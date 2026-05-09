import Papa from 'papaparse';

/** Fixed comma delimiter so Papa never enters undetectable-delimiter guessing (still filter noise below). */
const COMMA_SEPARATED = {
  skipEmptyLines: true as const,
  delimiter: ',' as const,
};

function ignorablePapaError(e: { type?: string; code?: string; message?: string }): boolean {
  const code = String(e.code ?? '');
  const typ = String(e.type ?? '');
  const msg = String(e.message ?? '');
  if (code === 'UndetectableDelimiter') return true;
  if (typ === 'Delimiter' && code === 'UndetectableDelimiter') return true;
  if (/unable\s+to\s+auto[-\s]?detect/i.test(msg) && /delimit/i.test(msg)) return true;
  return false;
}

export function fatalPapaParseErrors(errors: Array<{ type?: string; code?: string; message?: string }> | undefined) {
  if (!errors?.length) return [];
  return errors.filter((e) => !ignorablePapaError(e));
}

export function parseKeyedCsvRecords(text: string): Papa.ParseResult<Record<string, string>> {
  const results = Papa.parse<Record<string, string>>(text, { ...COMMA_SEPARATED, header: true });
  const fatal = fatalPapaParseErrors(results.errors);
  if (fatal.length) {
    const err = new Error(fatal[0]?.message || 'CSV inválido');
    throw err;
  }
  return results;
}

export function parseMatrixCsv(text: string): Papa.ParseResult<string[]> {
  const results = Papa.parse<string[]>(text, { ...COMMA_SEPARATED, header: false });
  const fatal = fatalPapaParseErrors(results.errors);
  if (fatal.length) {
    throw new Error(fatal[0]?.message || 'CSV inválido');
  }
  return results;
}
