import { useNavigate } from 'react-router-dom';
import { Briefcase, MapPin, Clock, MessageCircle, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWhatsAppRedirect } from '@/hooks/useWhatsAppRedirect';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatRelativeTime } from '@/lib/timeUtils';
import { formatSalaryBRL } from '@/lib/salaryUtils';
import { parseHighlights } from '@/lib/highlightUtils';

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
    created_at: string;
    is_active: boolean;
  };
}

const JobCard = ({ job }: JobCardProps) => {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();

  const title = job.title;
  const summary = job.summary;
  const highlightPreview = job.highlights ? parseHighlights(job.highlights.join('\n')).slice(0, 2).join(' • ') : '';

  const { handleApply, QRModal } = useWhatsAppRedirect(title, job.b_name);

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
                <img src={job.b_logo_url} alt={job.b_name} className="h-10 w-10 rounded-md object-cover border" />
              ) : (
                <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center">
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-sm font-semibold leading-none">{job.b_name}</p>
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
          {(summary || highlightPreview) && (
            <div className="mt-2 min-h-[2.5rem] space-y-1">
              {summary && (
                <CardDescription className="text-xs line-clamp-2">
                  {summary}
                </CardDescription>
              )}
              {highlightPreview && (
                <p className="text-muted-foreground text-[11px] line-clamp-1">
                  {highlightPreview}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        
        <CardContent className="p-5 pt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <MapPin className="mr-1 h-3 w-3" /> {job.location}
            </Badge>
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <Briefcase className="mr-1 h-3 w-3" /> {job.job_type}
            </Badge>
            <Badge variant="secondary" className="rounded-md font-medium text-[10px] px-2 py-0">
              <Building2 className="mr-1 h-3 w-3" /> {job.workplace_type}
            </Badge>
          </div>
          
          <div className="flex items-baseline space-x-1">
            <span className="text-xl font-bold text-primary">{formatSalaryBRL(job.salary_amount)}</span>
            <span className="text-[10px] text-muted-foreground font-medium">{job.payment_frequency}</span>
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
