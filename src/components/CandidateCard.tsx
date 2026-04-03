import { MapPin, Briefcase, User } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';

type Candidate = {
  id: string;
  role_slug: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  country: string | null;
  city: string | null;
  summary: string | null;
  has_contact: boolean | null;
  created_at: string;
};

const BOT_NUMBER = '528132689375';

const maskName = (firstName: string | null, lastName: string | null, fallback: string | null) => {
  const cap = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v);
  const safeParts = (v: string) => fixJobTextArtifacts(String(v || '')).trim().split(/\s+/).filter(Boolean);

  const firstParts = safeParts(firstName || '');
  const lastParts = safeParts(lastName || '');
  const rawParts = safeParts(fallback || '');

  const first = firstParts[0] || rawParts[0] || '';
  const last = lastParts[0] || (rawParts.length >= 2 ? rawParts[rawParts.length - 1] : '');

  if (first && last) return `${cap(first)} ${cap(last[0])}.`;
  if (first) return cap(first);
  if (last) return `${cap(last[0])}.`;
  return 'Profissional';
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getQueryTokens = (query: string) =>
  Array.from(new Set(String(query || '').trim().split(/\s+/).map((t) => t.trim()).filter(Boolean)));

const queryMatches = (text: string, query: string) => {
  const tokens = getQueryTokens(query);
  if (tokens.length === 0) return false;
  const hay = String(text || '').toLowerCase();
  return tokens.some((t) => hay.includes(t.toLowerCase()));
};

const renderHighlighted = (text: string, query: string) => {
  const q = String(query || '').trim();
  if (!q) return text;
  const tokens = getQueryTokens(q);
  if (tokens.length === 0) return text;
  const pattern = tokens.map(escapeRegExp).join('|');
  if (!pattern) return text;
  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(re);
  if (parts.length <= 1) return text;
  return (
    <>
      {parts.map((part, idx) => {
        const isHit = re.test(part);
        re.lastIndex = 0;
        return isHit ? (
          <mark key={idx} className="bg-primary/20 text-foreground px-1 rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        );
      })}
    </>
  );
};

const toTitleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

const toSpanishRoleLabel = (raw: string) => {
  const cleaned = fixJobTextArtifacts(String(raw || '')).trim();
  const slug = cleaned.toLowerCase().replace(/[_\s]+/g, '-');
  const dict: Record<string, string> = {
    driver: 'Conductor',
    'security-guard': 'Guardia De Seguridad',
    cleaner: 'Personal De Limpieza',
    chef: 'Chef',
    cook: 'Cocinero',
    'sales-representative': 'Representante De Ventas',
    'sales-promoter': 'Promotor De Ventas',
    receptionist: 'Recepcionista',
    waitress: 'Mesera',
    waiter: 'Mesero',
    'delivery-driver': 'Repartidor',
  };
  const mapped = dict[slug];
  if (mapped) return mapped;
  const fromSlug = cleaned.includes('-') && !cleaned.includes(' ') ? cleaned.replace(/-+/g, ' ') : cleaned;
  return toTitleCase(fromSlug);
};

const buildWaUrl = (candidate: Candidate) => {
  const role = toSpanishRoleLabel(candidate.job_title || candidate.role_slug || 'candidato');
  const loc = fixJobTextArtifacts(candidate.country || candidate.city || 'Brasil');
  const name = maskName(candidate.first_name, candidate.last_name, candidate.full_name);
  const msg = `Hola! Estoy interesado en este perfil de candidato en MyJob.\n\nID: ${candidate.id}\nPuesto: ${role}\nUbicación: ${loc}\nNombre (oculto): ${name}\n\n¿Me puedes compartir el contacto?`;
  return `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(msg)}`;
};

const CandidateCard = ({ candidate, query }: { candidate: Candidate; query?: string }) => {
  const title = toSpanishRoleLabel(candidate.job_title || candidate.role_slug || 'Profissional');
  const name = maskName(candidate.first_name, candidate.last_name, candidate.full_name);
  const country = candidate.country ? fixJobTextArtifacts(candidate.country) : '';
  const city = candidate.city ? fixJobTextArtifacts(candidate.city) : '';
  const summary = candidate.summary ? fixJobTextArtifacts(candidate.summary) : '';
  const location = [country, city].filter(Boolean).join(' • ') || 'Brasil';
  const roleLabel = toSpanishRoleLabel(candidate.job_title || candidate.role_slug || '');
  const roleRaw = fixJobTextArtifacts(candidate.job_title || candidate.role_slug || '');
  const q = query || '';
  const highlightByRawRole = queryMatches(roleRaw, q) && !queryMatches(roleLabel, q);

  return (
    <Card className="rounded-3xl border-border/50 overflow-hidden">
      <CardHeader className="p-6 pb-0 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-extrabold text-foreground leading-tight">
              {highlightByRawRole ? (
                <mark className="bg-primary/20 text-foreground px-1 rounded-sm">{title}</mark>
              ) : (
                renderHighlighted(title, q)
              )}
            </h3>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <User className="h-4 w-4" /> {name}
            </p>
          </div>
          <a href={buildWaUrl(candidate)} target="_blank" rel="noopener noreferrer">
            <Button variant="whatsapp" className="rounded-2xl font-bold">
              Contratar agora
            </Button>
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
            <MapPin className="mr-1 h-3 w-3" /> {location}
          </Badge>
          <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
            <Briefcase className="mr-1 h-3 w-3" />{' '}
            {highlightByRawRole ? (
              <mark className="bg-primary/20 text-foreground px-1 rounded-sm">{roleLabel}</mark>
            ) : (
              renderHighlighted(roleLabel, q)
            )}
          </Badge>
          {candidate.has_contact ? (
            <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
              Contato disponível
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4 space-y-4">
        {summary ? <p className="text-sm text-muted-foreground leading-relaxed">{renderHighlighted(summary, q)}</p> : null}
      </CardContent>
    </Card>
  );
};

export default CandidateCard;
