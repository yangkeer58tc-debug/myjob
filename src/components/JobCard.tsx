import { useNavigate } from 'react-router-dom';
import { Briefcase, MapPin, Clock, MessageCircle, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWhatsAppRedirect } from '@/hooks/useWhatsAppRedirect';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatRelativeTime } from '@/lib/timeUtils';
import { formatSalaryMXN } from '@/lib/salaryUtils';
import { optionLabel, EDUCATION_LEVEL_OPTIONS, EXPERIENCE_OPTIONS, JOB_TYPE_OPTIONS, WORKPLACE_TYPE_OPTIONS, PAYMENT_FREQUENCY_OPTIONS } from '@/lib/jobOptions';
import { fixJobTextArtifacts } from '@/lib/jobTextUtils';

interface JobCardProps {
  job: {
    id: string;
    title: string;
    b_name: string;
    b_logo_url: string | null;
    location: string;
    job_type: string;
    workplace_type: string;
    salary_amount: string;
    payment_frequency: string;
    summary: string | null;
    highlights: string[] | null;
    education_level?: string | null;
    experience?: string | null;
    created_at: string;
    is_active: boolean;
  };
}

const JobCard = ({ job }: JobCardProps) => {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();

  const title = fixJobTextArtifacts(job.title);
  const summary = job.summary;
  const tagsPreview = [job.education_level ? optionLabel(job.education_level, EDUCATION_LEVEL_OPTIONS) : '', job.experience ? optionLabel(job.experience, EXPERIENCE_OPTIONS) : '']
    .filter(Boolean)
    .slice(0, 2)
    .join(' • ');

  const safeCompany = fixJobTextArtifacts(job.b_name);
  const safeLocation = fixJobTextArtifacts(job.location);
  const { handleApply, QRModal } = useWhatsAppRedirect(title, safeCompany);

  return (
    <>
      <Card
        onClick={() => navigate(`/empleo/${job.id}`)}
        className="group relative flex flex-col overflow-hidden transition-all hover:shadow-md cursor-pointer border-border/50"
      >
        <CardHeader className="p-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              {job.b_logo_url ? (
                <img src={job.b_logo_url} alt={safeCompany} className="h-10 w-10 rounded-md object-cover border" />
              ) : (
                <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center">
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-sm font-semibold leading-none">{safeCompany}</p>
                <div className="flex items-center text-[10px] text-muted-foreground">
                  <Clock className="mr-1 h-3 w-3" />
                  {formatRelativeTime(job.created_at, lang)}
                </div>
              </div>
            </div>
          </div>
          <CardTitle className="text-lg font-bold group-hover:text-primary transition-colors line-clamp-1">
            {title}
          </CardTitle>
          {(summary || tagsPreview) && (
            <div className="mt-2 min-h-[2.5rem] space-y-1">
              {summary && (
                <CardDescription className="text-xs line-clamp-2">
                  {summary}
                </CardDescription>
              )}
              {tagsPreview && (
                <p className="text-muted-foreground text-[11px] line-clamp-1">
                  {tagsPreview}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        
        <CardContent className="p-5 pt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <MapPin className="mr-1 h-3 w-3" /> {safeLocation}
            </Badge>
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <Briefcase className="mr-1 h-3 w-3" /> {optionLabel(job.job_type, JOB_TYPE_OPTIONS)}
            </Badge>
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <Building2 className="mr-1 h-3 w-3" /> {optionLabel(job.workplace_type, WORKPLACE_TYPE_OPTIONS)}
            </Badge>
          </div>
          
          <div className="flex items-baseline space-x-1">
            <span className="text-xl font-bold text-primary">{formatSalaryMXN(job.salary_amount)}</span>
            <span className="text-[10px] text-muted-foreground font-medium">{optionLabel(job.payment_frequency, PAYMENT_FREQUENCY_OPTIONS)}</span>
          </div>
        </CardContent>

        <CardFooter className="p-5 pt-0 mt-auto">
          <Button
            variant="whatsapp"
            className="w-full font-bold shadow-sm"
            onClick={(e) => handleApply(e)}
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            {t('wa.apply')}
          </Button>
        </CardFooter>
      </Card>
      <QRModal />
    </>
  );
};

export default JobCard;
