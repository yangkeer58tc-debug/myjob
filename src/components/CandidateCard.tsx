import { useMemo, useState } from 'react';
import { MapPin, User } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';
import { queryMatchesText, renderSearchHighlight } from '@/lib/searchHighlight';
import { QRCodeSVG } from 'qrcode.react';
import { trackContactClick } from '@/lib/analytics';

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
  work_years: number | null;
  education_years: number | null;
  created_at: string;
};

const BOT_NUMBER = '5218132689146';

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
  return 'Profesional';
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
    'administrative-assistant': 'Asistente Administrativo',
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

const isMobileDevice = () =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const buildWaMessage = (candidate: Candidate) => {
  const role = toSpanishRoleLabel(candidate.job_title || candidate.role_slug || 'candidato');
  const loc = fixJobTextArtifacts(candidate.country || candidate.city || 'México');
  const name = maskName(candidate.first_name, candidate.last_name, candidate.full_name);
  return `Hola! Estoy interesado en este perfil de candidato en MyJob.\n\nID: ${candidate.id}\nPuesto: ${role}\nUbicación: ${loc}\nNombre (oculto): ${name}\n\n¿Me puedes compartir el contacto?`;
};

const buildWaUrl = (candidate: Candidate) => {
  const msg = buildWaMessage(candidate);
  return `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(msg)}`;
};

const CandidateCard = ({ candidate, query }: { candidate: Candidate; query?: string }) => {
  const title = toSpanishRoleLabel(candidate.job_title || candidate.role_slug || 'Profesional');
  const name = maskName(candidate.first_name, candidate.last_name, candidate.full_name);
  const country = candidate.country ? fixJobTextArtifacts(candidate.country) : '';
  const city = candidate.city ? fixJobTextArtifacts(candidate.city) : '';
  const summary = candidate.summary ? fixJobTextArtifacts(candidate.summary) : '';
  const location = [country, city].filter(Boolean).join(' • ') || 'México';
  const roleRaw = fixJobTextArtifacts(candidate.job_title || candidate.role_slug || '');
  const q = query || '';
  const highlightByRawRole = queryMatchesText(roleRaw, q) && !queryMatchesText(title, q);
  const [qrOpen, setQrOpen] = useState(false);
  const waUrl = useMemo(() => buildWaUrl(candidate), [candidate]);
  const waText = useMemo(() => encodeURIComponent(buildWaMessage(candidate)), [candidate]);

  const handleWhatsApp = () => {
    trackContactClick({
      contact_channel: 'whatsapp',
      contact_location: 'candidate_card_hire_button',
      source: 'candidate_card',
      candidate_id: candidate.id,
      candidate_role: title,
    });
    if (isMobileDevice()) window.location.href = `whatsapp://send?phone=${BOT_NUMBER}&text=${waText}`;
    else setQrOpen(true);
  };

  return (
    <Card className="rounded-2xl border-border/60 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="p-6 pb-0 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-extrabold text-foreground leading-tight">
              {highlightByRawRole ? (
                <mark className="bg-primary/20 text-foreground px-1 rounded-sm">{title}</mark>
              ) : (
                renderSearchHighlight(title, q)
              )}
            </h3>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <User className="h-4 w-4" /> {name}
            </p>
          </div>
          <Button variant="whatsapp" className="rounded-2xl font-bold" onClick={handleWhatsApp}>
            Contratar agora
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
            <MapPin className="mr-1 h-3 w-3" /> {location}
          </Badge>
          {typeof candidate.work_years === 'number' && candidate.work_years > 0 ? (
            <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
              {candidate.work_years} {candidate.work_years === 1 ? 'año' : 'años'} exp.
            </Badge>
          ) : null}
          {typeof candidate.education_years === 'number' && candidate.education_years > 0 ? (
            <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
              {candidate.education_years} {candidate.education_years === 1 ? 'año' : 'años'} edu.
            </Badge>
          ) : null}
          {candidate.has_contact ? (
            <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
              Contacto disponible
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4 space-y-4">
        {summary ? <p className="text-sm text-muted-foreground leading-relaxed">{renderSearchHighlight(summary, q)}</p> : null}
      </CardContent>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-bold">Escanea para abrir WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="rounded-2xl bg-card p-4 shadow-sm">
              <QRCodeSVG value={waUrl} size={220} />
            </div>
            <p className="text-center text-sm text-muted-foreground max-w-xs">
              Escanea este código QR con WhatsApp en tu teléfono para abrir la conversación.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default CandidateCard;
