import { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trackStructuredEvent, type IndependentEventName } from '@/lib/analytics';
import { getWhatsAppBotNumber } from '@/lib/whatsappBotNumber';

type ContactTrackingContext = {
  event_name: IndependentEventName;
  module: string;
  item_id?: string;
  item_name?: string;
  position?: number;
  cta_name?: string;
};

export const useWhatsAppRedirect = (
  jobTitle: string,
  bName: string,
  trackingContext?: ContactTrackingContext,
) => {
  const { t } = useLanguage();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  const msg = t('wa.defaultMessage') 
    ? t('wa.defaultMessage').replace('{jobTitle}', jobTitle || '').replace('{bName}', bName || '')
    : `¡Hola! Me interesa la vacante de ${jobTitle} en ${bName} que vi en MyJob.`;
  
  const botNumber = getWhatsAppBotNumber();
  const encodedMsg = encodeURIComponent(msg);
  const waUrl = `https://wa.me/${botNumber}?text=${encodedMsg}`;

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handleApply = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (trackingContext) {
      trackStructuredEvent(trackingContext.event_name, {
        module: trackingContext.module,
        item_id: trackingContext.item_id,
        item_name: trackingContext.item_name || jobTitle,
        position: trackingContext.position,
        cta_name: trackingContext.cta_name,
      });
    }
    if (isMobile) {
      window.location.href = `whatsapp://send?phone=${botNumber}&text=${encodedMsg}`;
    } else {
      setQrUrl(waUrl);
      setQrOpen(true);
    }
  }, [botNumber, encodedMsg, isMobile, jobTitle, trackingContext, waUrl]);

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
