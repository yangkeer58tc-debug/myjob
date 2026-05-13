/** Decode uploaded CSV/TSV bytes — UTF-8 / UTF-16 / Windows-1252 fallbacks (same as admin job import). */
export async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const decode = (encoding: string) => new TextDecoder(encoding, { fatal: false }).decode(buffer);
  const hasManyNulls = (text: string) => {
    let n = 0;
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 0) n += 1;
    return n > 10;
  };

  const hasBomUtf8 = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const hasBomUtf16le = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasBomUtf16be = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;

  if (hasBomUtf16le) return decode('utf-16le');
  if (hasBomUtf16be) return decode('utf-16be');
  if (hasBomUtf8) return decode('utf-8');

  const utf8 = decode('utf-8');
  if (!utf8.includes('\uFFFD') && !hasManyNulls(utf8)) return utf8;

  const utf16le = decode('utf-16le');
  if (!utf16le.includes('\uFFFD') && !hasManyNulls(utf16le)) return utf16le;

  const win1252 = decode('windows-1252');
  if (!win1252.includes('\uFFFD')) return win1252;

  try {
    const latin1 = decode('iso-8859-1');
    if (!latin1.includes('\uFFFD')) return latin1;
    return latin1;
  } catch {
    return win1252;
  }
}
