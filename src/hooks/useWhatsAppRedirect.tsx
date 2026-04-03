import { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/contexts/LanguageContext';

const BOT_NUMBER = '5218132689375';

export const useWhatsAppRedirect = (jobTitle: string, bName: string) => {
  const { t } = useLanguage();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  const msg = t('wa.defaultMessage') 
    ? t('wa.defaultMessage').replace('{jobTitle}', jobTitle || '').replace('{bName}', bName || '')
    : `Olá! Tenho interesse na vaga de ${jobTitle} da empresa ${bName} que vi no MyJob.`;
  
  const encodedMsg = encodeURIComponent(msg);
  const waUrl = `https://wa.me/${BOT_NUMBER}?text=${encodedMsg}`;

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handleApply = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isMobile) {
      window.location.href = `whatsapp://send?phone=${BOT_NUMBER}&text=${encodedMsg}`;
    } else {
      setQrUrl(waUrl);
      setQrOpen(true);
    }
  }, [encodedMsg, isMobile, waUrl]);

  const QRModal = () => (
    <Dialog open={qrOpen} onOpenChange={setQrOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">
            {t('wa.scanTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="rounded-2xl bg-card p-4 shadow-sm">
            <QRCodeSVG value={qrUrl} size={220} />
          </div>
          <p className="text-center text-sm text-muted-foreground max-w-xs">
            {t('wa.scanSubtext')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { handleApply, QRModal };
};
