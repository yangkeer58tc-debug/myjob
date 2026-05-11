// Pure parsing/validation helpers for the WhatsApp recruitment bot.
//
// Kept free of any Deno- or Supabase-specific imports so that both the Edge
// Function (Deno runtime) and the vitest suite (Node) can use them.

export const NAME_MAX_LEN = 80;
export const NAME_MIN_LEN = 2;

/** Quick-reply button ids (must match outbound interactive payloads). */
export const BTN_OPT_IN_YES = 'WA_OPT_YES';
export const BTN_OPT_IN_NO = 'WA_OPT_NO';
export const BTN_RET_SAME = 'WA_RET_SAME';
export const BTN_RET_NEW = 'WA_RET_NEW';
export const BTN_MORE_JOBS = 'WA_MORE_JOBS';
export const BTN_REC_JOBS = 'WA_REC_JOBS';
export const BTN_HELP = 'WA_HELP';
export const BTN_JOIN_PANEL = 'WA_JOIN_PANEL';

/** First inbound from wa.me may carry `[REF:<jobId>]` (digits) for job context. */
export function extractJobRefFromText(raw: string | undefined | null): string | null {
  const m = String(raw ?? '').match(/\[REF:([\w-]+)\]/i);
  const id = m?.[1]?.trim();
  return id || null;
}

export function stripJobRefTag(raw: string): string {
  return String(raw ?? '').replace(/\s*\[REF:[\w-]+\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

const NO_CV_PHRASES = [
  'no tengo cv',
  'no tengo curriculum',
  'no tengo currículum',
  'no tengo curriculo',
  'no traigo cv',
  'no traigo curriculum',
  'no lo tengo',
  'no cuento con cv',
  'no dispongo',
  'no dispongo de cv',
  'luego lo paso',
  'luego te lo paso',
  'mas tarde',
  'más tarde',
  'despues',
  'después',
  'manana',
  'mañana',
  'todavia no',
  'todavía no',
  'aun no',
  'aún no',
  'todavia no tengo',
  'todavía no tengo',
  'se me olvido',
  'se me olvidó',
  'primero quiero',
  'una pregunta',
  'no puedo enviar',
  'no puedo mandar',
  'no tengo archivo',
  'no tengo documento',
  'no tengo el cv',
  'no tengo mi cv',
  'aun no tengo cv',
  'aún no tengo cv',
  'todavia no tengo el cv',
  'todavía no tengo el cv',
  'no tengo todavia',
  'no tengo todavía',
];

/** Heuristic: user says they cannot send a CV right now. */
export function expressesNoCv(raw: string | undefined | null): boolean {
  const n = normalizeOptInText(String(raw ?? '')).replace(/[,;]+/g, ' ');
  if (!n) return false;
  return NO_CV_PHRASES.some((p) => n === p || n.includes(p));
}

// Best-effort cleanup of a free-text "name" reply. Returns the canonical form
// to store, or `null` if the text doesn't look like a name at all.
//
// Rules:
//   - Collapse runs of whitespace.
//   - Reject if it looks like a URL.
//   - Require at least one Unicode letter (any script).
//   - Truncate to NAME_MAX_LEN characters.
//   - Reject anything shorter than NAME_MIN_LEN.
export function sanitizeName(raw: string): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (/https?:\/\/|www\./i.test(collapsed)) return null;
  const normalized = collapsed.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (!/\p{L}/u.test(normalized)) return null;
  if (collapsed.length < NAME_MIN_LEN) return null;
  return collapsed.slice(0, NAME_MAX_LEN);
}

// Lower-cases, trims and drops trailing punctuation (`. ! ?` and whitespace).
export function normalizeOptInText(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase().replace(/[.!?\s]+$/u, '');
}

// Strict positive: PRD v3 §5 spec. After normalization, the message must be
// EXACTLY "si" or "sí". Anything else is a non-positive — including "claro",
// "si claro", emojis, etc. We tolerate trailing punctuation and casing.
export function isStrictSi(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed === BTN_OPT_IN_YES) return true;
  const cleaned = normalizeOptInText(trimmed);
  return cleaned === 'si' || cleaned === 'sí';
}

/** Returning-user branch: same CV as RMC (button id or short text; not plain "sí"). */
export function isReturningSameCvChoice(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed === BTN_RET_SAME) return true;
  const cleaned = normalizeOptInText(stripJobRefTag(trimmed));
  return (
    cleaned === 'mismo' ||
    cleaned === 'mismo cv' ||
    cleaned === 'el mismo' ||
    cleaned === 'el mismo cv' ||
    cleaned.startsWith('mismo cv ')
  );
}

const NEGATIVE_PHRASES = [
  'no',
  'no gracias',
  'no quiero',
  'paso',
  'luego',
  'mañana',
  'manana',
  'despues',
  'después',
  'mas tarde',
  'más tarde',
];

// Heuristic explicit "no". When this matches we close the conversation
// gracefully without further clarifications.
export function isExplicitNo(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed === BTN_OPT_IN_NO) return true;
  const cleaned = normalizeOptInText(trimmed);
  if (!cleaned) return false;
  return NEGATIVE_PHRASES.some(
    (p) => cleaned === p || cleaned.startsWith(`${p} `) || cleaned.startsWith(`${p},`),
  );
}

// Translate the raw wa_user_id (digits, e.g. 528132689146 / 5218132689146)
// into the E.164 phone the RMC `whatsapp` column expects ("+5218132689146").
//
// We standardize Mexican mobile numbers to the legacy 13-digit form (52 + 1 +
// 10 digits) because that's how WhatsApp wa_id is registered in RMC. Other
// countries keep their inbound digits prefixed with "+".
export function toE164ForRmc(waUserId: string): string {
  const digits = waUserId.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+521${digits.slice(2)}`;
  }
  return `+${digits}`;
}

// Pick a file extension based on MIME first, then filename suffix, then a
// safe fallback ("bin").
export function extFromMime(mime?: string, filename?: string): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('officedocument.wordprocessingml')) return 'docx';
  if (m.includes('msword')) return 'doc';
  if (m.includes('jpeg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  const fname = String(filename ?? '');
  const dot = fname.lastIndexOf('.');
  if (dot >= 0 && dot < fname.length - 1) {
    const ext = fname.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ext.length >= 2 && ext.length <= 5) return ext;
  }
  return 'bin';
}
