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
  has_contact: boolean;
  created_at: string;
};

const BOT_NUMBER = '528132689146';

const maskName = (firstName: string | null, lastName: string | null, fallback: string | null) => {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  if (first && last) return `${first} ${last[0]}.`;
  const raw = (fallback || '').trim();
  if (!raw) return 'Profissional';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]}*`;
};

const buildWaUrl = (candidate: Candidate) => {
  const role = fixJobTextArtifacts(candidate.role_slug || candidate.job_title || 'candidato');
  const loc = fixJobTextArtifacts(candidate.country || candidate.city || 'Brasil');
  const msg = `Olá! Quero contratar um ${role}. Vi um perfil no MyJob (ID: ${candidate.id}, ${loc}).`;
  return `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(msg)}`;
};

const CandidateCard = ({ candidate }: { candidate: Candidate }) => {
  const title = fixJobTextArtifacts(candidate.job_title || candidate.role_slug || 'Profissional');
  const name = maskName(candidate.first_name, candidate.last_name, candidate.full_name);
  const country = candidate.country ? fixJobTextArtifacts(candidate.country) : '';
  const city = candidate.city ? fixJobTextArtifacts(candidate.city) : '';
  const summary = candidate.summary ? fixJobTextArtifacts(candidate.summary) : '';
  const location = [country, city].filter(Boolean).join(' • ') || 'Brasil';

  return (
    <Card className="rounded-3xl border-border/50 overflow-hidden">
      <CardHeader className="p-6 pb-0 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-extrabold text-foreground leading-tight">{title}</h3>
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
            <Briefcase className="mr-1 h-3 w-3" /> {fixJobTextArtifacts(candidate.role_slug || candidate.job_title || '')}
          </Badge>
          {candidate.has_contact ? (
            <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
              Contato disponível
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4 space-y-4">
        {summary ? <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p> : null}
      </CardContent>
    </Card>
  );
};

export default CandidateCard;
