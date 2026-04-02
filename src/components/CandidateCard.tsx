import { MapPin, Briefcase, Clock, User } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';

type Candidate = {
  id: string;
  role_slug: string;
  full_name: string | null;
  age: number | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  experience: string | null;
  employment_type: string | null;
  salary_expectation: string | null;
  availability: string | null;
  created_at: string;
};

const BOT_NUMBER = '528132689146';

const buildWaUrl = (candidate: Candidate) => {
  const name = candidate.full_name ? fixJobTextArtifacts(candidate.full_name) : 'candidato';
  const role = fixJobTextArtifacts(candidate.role_slug || 'candidato');
  const loc = candidate.location ? fixJobTextArtifacts(candidate.location) : 'Brasil';
  const msg = `Olá! Quero contratar um ${role}. Vi o perfil (${name}, ${loc}) no MyJob. ID: ${candidate.id}.`;
  return `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(msg)}`;
};

const CandidateCard = ({ candidate }: { candidate: Candidate }) => {
  const title = candidate.headline ? fixJobTextArtifacts(candidate.headline) : fixJobTextArtifacts(candidate.role_slug);
  const name = candidate.full_name ? fixJobTextArtifacts(candidate.full_name) : 'Profissional';
  const location = candidate.location ? fixJobTextArtifacts(candidate.location) : 'Brasil';
  const summary = candidate.summary ? fixJobTextArtifacts(candidate.summary) : '';
  const experience = candidate.experience ? fixJobTextArtifacts(candidate.experience) : '';
  const employment = candidate.employment_type ? fixJobTextArtifacts(candidate.employment_type) : '';
  const salary = candidate.salary_expectation ? fixJobTextArtifacts(candidate.salary_expectation) : '';
  const availability = candidate.availability ? fixJobTextArtifacts(candidate.availability) : '';
  const age = typeof candidate.age === 'number' ? candidate.age : null;

  return (
    <Card className="rounded-3xl border-border/50 overflow-hidden">
      <CardHeader className="p-6 pb-0 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-extrabold text-foreground leading-tight">{title}</h3>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <User className="h-4 w-4" /> {name}
              {age !== null ? <span className="text-muted-foreground">• {age} anos</span> : null}
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
            <Briefcase className="mr-1 h-3 w-3" /> {fixJobTextArtifacts(candidate.role_slug)}
          </Badge>
          <Badge variant="secondary" className="rounded-md font-medium text-[11px] px-2 py-0.5">
            <Clock className="mr-1 h-3 w-3" /> Disponível
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-4 space-y-4">
        {(summary || experience) && (
          <div className="space-y-2">
            {summary ? <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p> : null}
            {experience ? <p className="text-sm text-muted-foreground leading-relaxed">{experience}</p> : null}
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-secondary rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">Modelo</p>
            <p className="font-semibold text-foreground">{employment || 'A combinar'}</p>
          </div>
          <div className="bg-secondary rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">Pretensão</p>
            <p className="font-semibold text-foreground">{salary || 'A combinar'}</p>
          </div>
          <div className="bg-secondary rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">Disponibilidade</p>
            <p className="font-semibold text-foreground">{availability || 'Imediata'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CandidateCard;

