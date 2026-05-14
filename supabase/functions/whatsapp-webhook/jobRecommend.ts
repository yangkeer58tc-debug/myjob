// Pure helpers + types for WhatsApp in-chat job recommendations (Edge + vitest).

import { canonicalSiteCategory } from './jobRecommendCanonical.ts';

export const OK_COM_JOBS_B_NAME = 'OK.com Jobs';

export type JobRecRow = {
  id: string;
  slug: string | null;
  title: string;
  b_name: string;
  location: string;
  salary_amount: string;
  payment_frequency: string;
  job_type: string;
  workplace_type: string;
  category: string | null;
  mx_category_code: string | null;
  summary: string | null;
  industry: string | null;
  experience: string | null;
  education_level: string | null;
  is_active: boolean;
  created_at: string;
};

/** YYYY-MM-DD in America/Mexico_City for daily recommendation caps. */
export function mexicoCityDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** OK feed uses `MX · …` while IMC often uses English free text — strip for comparison. */
function industryComparable(s: string | null | undefined): string {
  return norm(s)
    .replace(/^mx\s*[·.:]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function industryWordOverlap(a: string, b: string): number {
  const wa = a.split(/[\s,/|·]+/).filter((w) => w.length > 3);
  const wb = new Set(b.split(/[\s,/|·]+/).filter((w) => w.length > 3));
  if (!wa.length || !wb.size) return 0;
  return wa.filter((w) => wb.has(w)).length;
}

export function scoreJobAgainstAnchor(job: JobRecRow, anchor: JobRecRow | null): number {
  if (!anchor) return 0;
  let score = 0;
  const ac = (anchor.category ?? '').trim();
  const jc = (job.category ?? '').trim();
  if (ac && jc && ac === jc) score += 100;
  else {
    const canA = canonicalSiteCategory(anchor);
    const canJ = canonicalSiteCategory(job);
    if (canA && canJ && canA === canJ) score += 90;
  }

  const amx = (anchor.mx_category_code ?? '').trim();
  const jmx = (job.mx_category_code ?? '').trim();
  if (amx && jmx && amx === jmx) score += 55;

  const ai = norm(anchor.industry);
  const ji = norm(job.industry);
  if (ai && ji && ai === ji) score += 40;
  else {
    const aci = industryComparable(anchor.industry);
    const jci = industryComparable(job.industry);
    if (aci && jci) {
      if (aci === jci) score += 38;
      else if (aci.includes(jci) || jci.includes(aci)) {
        const shorter = aci.length <= jci.length ? aci : jci;
        if (shorter.length >= 4) score += 28;
      } else {
        const overlap = industryWordOverlap(aci, jci);
        if (overlap > 0) score += Math.min(32, overlap * 10);
      }
    }
  }

  const al = (anchor.location ?? '').trim();
  const jl = (job.location ?? '').trim();
  if (al && jl && al === jl) score += 35;
  else if (al && jl) {
    const aw = al.split(/[\s,]+/).filter(Boolean)[0];
    const jw = jl.split(/[\s,]+/).filter(Boolean)[0];
    if (aw && jw && norm(aw) === norm(jw)) score += 18;
  }

  const at = norm(anchor.title);
  const jt = norm(job.title);
  if (at.length > 4 && jt.length > 4) {
    const words = at.split(/\s+/).filter((w) => w.length > 3);
    const hits = words.filter((w) => jt.includes(w)).length;
    if (hits) score += Math.min(30, hits * 5);
  }

  return score;
}

/** Sort: OK.com Jobs first, then score desc, then created_at desc. */
export function sortJobsForRecommendation(
  jobs: JobRecRow[],
  anchor: JobRecRow | null,
): JobRecRow[] {
  const scored = jobs.map((j) => ({ j, s: scoreJobAgainstAnchor(j, anchor) }));
  scored.sort((a, b) => {
    const okA = a.j.b_name === OK_COM_JOBS_B_NAME ? 0 : 1;
    const okB = b.j.b_name === OK_COM_JOBS_B_NAME ? 0 : 1;
    if (okA !== okB) return okA - okB;
    if (b.s !== a.s) return b.s - a.s;
    return new Date(b.j.created_at).getTime() - new Date(a.j.created_at).getTime();
  });
  return scored.map((x) => x.j);
}

/** WhatsApp linkifies `x.com` domains — show a middle dot so OK hiring brand stays readable. */
export function formatEmployerNameForWhatsApp(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return s;
  s = s.replace(/\bOK\.com\b/gi, 'OK·com');
  return s;
}

/** Strip accidental REF tags from titles (should not appear in DB, but OK feed can be messy). */
export function formatJobTitleForWhatsApp(raw: string): string {
  return String(raw ?? '')
    .replace(/\s*\[REF:[\w-]+\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hide MX slug / English code blobs; keep human-readable Spanish lines. */
export function formatIndustryForWhatsApp(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^MX\s*[·.:]\s*/i, '').trim();
  if (!s) return '';
  const slugLike = /^[a-zA-Z0-9\-_/|\s]+$/;
  const hyphens = (s.match(/-/g) ?? []).length;
  if (slugLike.test(s) && (s.length > 22 || hyphens >= 3)) return '';
  if (/cate[_-]?code|job[_-]?code|req[_-]?id|requisition/i.test(s)) return '';
  return s;
}

export function formatSummaryForWhatsApp(raw: string | null | undefined): string {
  let t = String(raw ?? '').trim();
  if (!t) return '';
  t = t.replace(/\bHighlights:\s*/gi, 'Destacados: ');
  t = t.replace(/\bAbout the role:\s*/gi, 'Rol: ');
  t = t.replace(/\bRequirements?:\s*/gi, 'Requisitos: ');
  t = t.replace(/\bKey responsibilities:\s*/gi, 'Responsabilidades: ');
  const lines = t.split(/\n/).map((l) => l.trim()).filter((L) => {
    if (!L) return false;
    if (/^(ID|Ref|SKU|REQ|REQ_ID|JobID|Posting)\s*[:=]/i.test(L)) return false;
    return true;
  });
  return lines.join('\n').trim();
}

export function pickNextRecommendedJob(
  jobs: JobRecRow[],
  anchor: JobRecRow | null,
  excludedJobIds: Set<string>,
): JobRecRow | null {
  const sorted = sortJobsForRecommendation(jobs, anchor);
  for (const j of sorted) {
    if (!excludedJobIds.has(j.id)) return j;
  }
  return null;
}

/** DB slug → short Spanish label for WhatsApp (aligned with site CATEGORY_OPTIONS). */
const CATEGORY_LABEL_ES: Record<string, string> = {
  'healthcare-medical': 'Salud',
  'call-center-customer-service': 'Atención / Call center',
  sales: 'Ventas',
  'mfg-transport-logistics': 'Logística',
  'trades-services': 'Servicios',
};

function formatCategoryForWhatsApp(raw: string): string {
  const id = raw.trim();
  if (!id) return '';
  return CATEGORY_LABEL_ES[id] ?? id.replace(/-/g, ' ');
}

const JOB_TYPE_LABEL_ES: Record<string, string> = {
  'tempo-integral': 'Tiempo completo',
  'meio-periodo': 'Medio tiempo',
  temporario: 'Temporal',
  freelancer: 'Freelance',
  estagio: 'Prácticas',
};

const WORKPLACE_LABEL_ES: Record<string, string> = {
  presencial: 'Presencial',
  hibrido: 'Híbrido',
  remoto: 'Remoto',
};

function formatJobTypeLine(jobType: string, workplace: string): string {
  const jt = JOB_TYPE_LABEL_ES[jobType.trim()] ?? jobType.trim();
  const wp = WORKPLACE_LABEL_ES[workplace.trim()] ?? workplace.trim();
  return `${jt} · ${wp}`;
}

export function formatJobCardBody(job: JobRecRow): string {
  const lines: string[] = [];
  lines.push(`*${formatJobTitleForWhatsApp(job.title)}*`);
  lines.push(`🏢 ${formatEmployerNameForWhatsApp(job.b_name.trim())}`);
  lines.push(`📍 ${job.location.trim()}`);
  const sal = [job.salary_amount?.trim(), job.payment_frequency?.trim()].filter(Boolean).join(' · ');
  if (sal) lines.push(`💰 ${sal}`);
  lines.push(`📋 ${formatJobTypeLine(job.job_type, job.workplace_type)}`);
  const cat = (job.category ?? '').trim();
  if (cat) lines.push(`📂 ${formatCategoryForWhatsApp(cat)}`);
  const indEs = formatIndustryForWhatsApp(job.industry);
  if (indEs) lines.push(`🏭 ${indEs}`);
  const exp = (job.experience ?? '').trim();
  if (exp) lines.push(`⏱ ${exp}`);
  const edu = (job.education_level ?? '').trim();
  if (edu) lines.push(`🎓 ${edu}`);
  const sum = formatSummaryForWhatsApp(job.summary);
  if (sum) {
    const short = sum.length > 320 ? `${sum.slice(0, 317)}…` : sum;
    lines.push('');
    lines.push(short);
  }
  return lines.join('\n');
}
