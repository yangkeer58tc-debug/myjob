import type { ResumeRecord } from './types';

export type EducationItem = {
  school?: string;
  degree?: string;
  major?: string;
  startDate?: string;
  endDate?: string;
  raw?: string;
};

export type ParsedResume = {
  name?: string;
  country?: string;
  city?: string;
  email?: string;
  whatsapp?: string;
  phone?: string;
  workYears?: number;
  education?: EducationItem[];
  introSummaryOriginal?: string;
};

const normalizeWhitespace = (s: string) =>
  String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\f\v]+/g, ' ')
    .replace(/\u00a0/g, ' ');

const splitDelimitedLine = (line: string, delimiter: ',' | '\t') => {
  if (delimiter === '\t') return line.split('\t').map((x) => x.trim());
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const normalizeFieldKey = (k: string) =>
  String(k || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const pickMapped = (m: ResumeRecord, keys: string[]) => {
  for (const key of keys) {
    const val = String(m[key] ?? '').trim();
    if (val) return val;
  }
  return undefined;
};

const parseJsonArray = (raw: string | undefined): unknown[] | null => {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === '\\N' || t === 'null') return null;
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const textRangeToYears = (v: string | undefined) => {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  const zh = t.match(/(\d+)\s*[-~]\s*(\d+)\s*年/);
  if (zh) return Number(zh[2]);
  if (t.includes('8+') || t.includes('8 years') || t.includes('8年以上')) return 8;
  const m = t.match(/\d{1,2}/);
  return m ? Number(m[0]) : undefined;
};

const extractEmail = (text: string) => {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return m?.[0];
};

const extractPhoneRaw = (text: string) => {
  const m = text.match(/\+?\d[\d\s().-]{6,}\d/);
  return m?.[0]?.replace(/\s+/g, ' ').trim();
};

const extractWorkYears = (text: string) => {
  const candidates: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})(?:\s*\+)?\s*(?:years?|yrs?)\b/gi)) candidates.push(Number(m[1]));
  for (const m of text.matchAll(/(?:工作|从业|经验)\s*(\d{1,2})\s*年/gi)) candidates.push(Number(m[1]));
  for (const m of text.matchAll(/(\d{1,2})\s*年(?:以上)?(?:工作)?经验/gi)) candidates.push(Number(m[1]));
  return candidates.length ? Math.max(...candidates) : undefined;
};

const extractName = (text: string) => {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const l of lines.slice(0, 40)) {
    const m = l.match(/^(?:Name|姓名)\s*[:：]\s*(.+)$/i);
    if (m?.[1]) return m[1].trim().slice(0, 80);
  }
  const ignored = /(email|e-mail|phone|tel|mobile|whats?app|linkedin|github|www\.|http)/i;
  for (const l of lines.slice(0, 12)) {
    if (ignored.test(l)) continue;
    const ascii = l.replace(/[^A-Za-z\s'.-]/g, '').trim();
    if (ascii.split(/\s+/).filter(Boolean).length >= 2 && ascii.length <= 40) return ascii;
    const cjk = l.replace(/[^\u4e00-\u9fff·\s]/g, '').replace(/\s+/g, '').trim();
    if (cjk.length >= 2 && cjk.length <= 6) return cjk;
  }
  return undefined;
};

const extractLocation = (text: string): { city?: string; country?: string } => {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const l of lines.slice(0, 60)) {
    const m = l.match(/^(?:Location|所在地|现居)\s*[:：]\s*(.+)$/i);
    if (!m?.[1]) continue;
    const v = m[1].trim();
    const parts = v.split(/[,，\-–—/|]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return { city: parts[0], country: parts[parts.length - 1] };
    return { city: v };
  }
  return {};
};

const extractEducation = (text: string): EducationItem[] | undefined => {
  const lines = normalizeWhitespace(text).split('\n');
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^Education\b/i.test(line) || line.startsWith('教育经历') || line.startsWith('教育背景')) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return undefined;
  const out: EducationItem[] = [];
  for (let i = idx + 1; i < Math.min(lines.length, idx + 30); i++) {
    const l = lines[i].replace(/^[-*•]\s*/, '').trim();
    if (!l) continue;
    if (/^(Experience|Skills|工作经历|项目经历)\b/i.test(l) && out.length >= 1) break;
    const parts = l.split(/[,，|]/).map((x) => x.trim()).filter(Boolean);
    const school = parts[0];
    const degree = parts.find((p) => /(BSc|MSc|PhD|Bachelor|Master|Doctor|本科|硕士|博士|学士|研究生|High school)/i.test(p));
    out.push({ school, degree, raw: l });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
};

const parseStructuredRow = (text: string): ParsedResume | null => {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0];
  const value = lines[1];
  const delimiter: ',' | '\t' = header.includes('\t') ? '\t' : ',';
  if (!header.includes(delimiter) || !value.includes(delimiter)) return null;
  const keys = splitDelimitedLine(header, delimiter).map(normalizeFieldKey);
  const vals = splitDelimitedLine(value, delimiter);
  if (keys.length < 5 || vals.length < 3) return null;
  const mapped: ResumeRecord = {};
  for (let i = 0; i < Math.min(keys.length, vals.length); i++) {
    if (keys[i]) mapped[keys[i]] = vals[i] || '';
  }
  const first = pickMapped(mapped, ['first_name', 'firstname', 'given_name']);
  const last = pickMapped(mapped, ['last_name', 'lastname', 'family_name', 'surname']);
  const full = pickMapped(mapped, ['full_name', 'name', 'candidate_name', 'user_name']);
  const name = full || [first, last].filter(Boolean).join(' ').trim() || undefined;
  const userConcat = parseJsonArray(pickMapped(mapped, ['user_concat', 'contacts']));
  let email = pickMapped(mapped, ['email', 'email_address']);
  let phone = pickMapped(mapped, ['phone', 'phone_number', 'mobile']);
  if (userConcat?.length) {
    for (const c of userConcat) {
      const o = c as ResumeRecord;
      const type = String(o.type || '').toLowerCase();
      const valueStr = String(o.value || '').trim();
      if (!valueStr) continue;
      if (!email && type === 'email') email = valueStr;
      if (!phone && type === 'phone') phone = valueStr;
    }
  }
  const workYears = textRangeToYears(
    pickMapped(mapped, ['work_years', 'work_experience_years', 'years_experience', 'experience_years']),
  );
  const summary =
    pickMapped(mapped, [
      'summary',
      'professional_summary',
      'profile_summary',
      'intro_summary_original',
      'self_introduction',
      'about_me',
      'personal_statement',
    ]) || undefined;
  let education: EducationItem[] | undefined;
  const eduArr = parseJsonArray(pickMapped(mapped, ['education_experience', 'education_history', 'education']));
  if (eduArr?.length) {
    education = eduArr.slice(0, 12).map((it) => {
      const o = it as ResumeRecord;
      return {
        school: typeof o.school === 'string' ? o.school : undefined,
        degree: typeof o.degree === 'string' ? o.degree : undefined,
        major: typeof o.subject === 'string' ? o.subject : undefined,
        startDate: typeof o.time_range === 'string' ? o.time_range : undefined,
        raw: typeof o.subject === 'string' ? o.subject : typeof o.school === 'string' ? o.school : undefined,
      };
    });
  }
  return {
    name,
    city: pickMapped(mapped, ['city', 'location_city']),
    country: pickMapped(mapped, ['country', 'nation', 'nationality']),
    email,
    phone,
    whatsapp: pickMapped(mapped, ['whatsapp', 'whatsapp_number']),
    workYears: typeof workYears === 'number' && Number.isFinite(workYears) ? workYears : undefined,
    education,
    introSummaryOriginal: summary,
  };
};

export const parseResumeText = (text: string): ParsedResume => {
  const normalized = normalizeWhitespace(text);
  const structured = parseStructuredRow(normalized);
  const loc = extractLocation(normalized);
  const summary = structured?.introSummaryOriginal || normalized.slice(0, 520).replace(/\s+/g, ' ').trim();
  return {
    name: structured?.name || extractName(normalized),
    city: structured?.city || loc.city,
    country: structured?.country || loc.country,
    email: structured?.email || extractEmail(normalized),
    phone: structured?.phone || extractPhoneRaw(normalized),
    whatsapp: structured?.whatsapp,
    workYears: structured?.workYears ?? extractWorkYears(normalized),
    education: structured?.education || extractEducation(normalized),
    introSummaryOriginal: summary || undefined,
  };
};

