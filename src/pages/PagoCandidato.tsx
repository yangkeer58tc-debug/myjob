import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Building2, CreditCard, Loader2, Store } from 'lucide-react';
import PublicLayout from '@/components/PublicLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { isCandidatePaywallEnabled } from '@/lib/candidatePaywallEnv';
import { getSiteOrigin } from '@/lib/siteUrl';

const DEFAULT_AMOUNT_MXN = 49;

const sanitizeReturnPath = (raw: string | null): string => {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return '/buscar-candidatos';
  return s;
};

const PagoCandidato = () => {
  const [searchParams] = useSearchParams();
  const paywallEnabled = useMemo(() => isCandidatePaywallEnabled(), []);
  const candidateId = String(searchParams.get('candidateId') || '').trim();
  const roleLabel = String(searchParams.get('role') || '').trim() || 'Candidato';
  const amountRaw = Number(searchParams.get('amount') || import.meta.env.VITE_CANDIDATE_CONTACT_PRICE_MXN || DEFAULT_AMOUNT_MXN);
  const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? Math.round(amountRaw * 100) / 100 : DEFAULT_AMOUNT_MXN;
  const returnPath = sanitizeReturnPath(searchParams.get('return'));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!paywallEnabled) {
    return <Navigate to="/buscar-candidatos" replace />;
  }

  if (!candidateId) {
    return <Navigate to="/buscar-candidatos" replace />;
  }

  const startCheckout = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const base = new URL(returnPath, window.location.origin);
      const returnUrl = new URL(base.toString());
      returnUrl.searchParams.set('aw_status', 'success');
      returnUrl.searchParams.set('aw_candidate', candidateId);

      const cancelUrl = new URL(base.toString());
      cancelUrl.searchParams.set('aw_status', 'cancel');
      cancelUrl.searchParams.set('aw_candidate', candidateId);

      const { data, error: fnError } = await supabase.functions.invoke('airwallex-create-checkout', {
        body: {
          candidateId,
          amount,
          currency: 'MXN',
          returnUrl: returnUrl.toString(),
          cancelUrl: cancelUrl.toString(),
          locale: 'es-MX',
          metadata: {
            candidate_role: roleLabel,
            source: 'pago_candidato_page',
          },
        },
      });

      if (fnError) throw fnError;
      const checkoutUrl = String((data as { checkoutUrl?: unknown })?.checkoutUrl || '').trim();
      if (!checkoutUrl) throw new Error('No se recibió el enlace de pago. Intenta de nuevo.');
      window.location.href = checkoutUrl;
    } catch (e) {
      setError(String((e as { message?: unknown })?.message || e || 'Error al iniciar el pago.'));
    } finally {
      setSubmitting(false);
    }
  };

  const origin = getSiteOrigin();

  return (
    <PublicLayout>
      <Helmet>
        <title>Pago seguro | MyJob</title>
        <meta name="description" content="Completa el pago para desbloquear el contacto del candidato en MyJob." />
        <link rel="canonical" href={`${origin}/pago-candidato`} />
      </Helmet>

      <div className="container mx-auto max-w-lg px-4 py-10">
        <div className="mb-6 text-center space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pago seguro en México</p>
          <h1 className="text-2xl font-extrabold text-foreground">Desbloquear contacto</h1>
          <p className="text-sm text-muted-foreground">
            En esta página eliges cómo pagar (tarjeta u otros métodos según disponibilidad). Al terminar volverás a la lista de candidatos.
          </p>
        </div>

        <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Resumen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-0">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Concepto</p>
                <p className="font-semibold text-foreground">Acceso por candidato</p>
                <p className="text-xs text-muted-foreground mt-1">ID: {candidateId.slice(0, 8)}… · {roleLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-extrabold text-foreground">${amount.toFixed(2)} MXN</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Métodos habituales en México</p>
              <p className="text-xs text-muted-foreground mb-3">
                La pasarela puede mostrar tarjeta, transferencia SPEI u otros según tu banco y la configuración del proveedor.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-card py-3 px-2">
                  <CreditCard className="h-6 w-6 text-primary" />
                  <span className="text-[11px] font-medium text-center leading-tight">Tarjeta</span>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-card py-3 px-2">
                  <Building2 className="h-6 w-6 text-primary" />
                  <span className="text-[11px] font-medium text-center leading-tight">SPEI</span>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-card py-3 px-2">
                  <Store className="h-6 w-6 text-primary" />
                  <span className="text-[11px] font-medium text-center leading-tight">Efectivo / tiendas</span>
                </div>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive break-words">{error}</p> : null}

            <div className="flex flex-col gap-2">
              <Button size="lg" className="rounded-xl font-bold w-full" onClick={startCheckout} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Conectando con la pasarela…
                  </>
                ) : (
                  'Ir a la página de pago'
                )}
              </Button>
              <Button variant="outline" asChild className="rounded-xl w-full">
                <Link to={returnPath}>Volver sin pagar</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PublicLayout>
  );
};

export default PagoCandidato;
