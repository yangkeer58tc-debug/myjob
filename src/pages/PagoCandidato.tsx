import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  CreditCard,
  Home,
  Loader2,
  Lock,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';
import PublicLayout from '@/components/PublicLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { isCandidatePaywallEnabled } from '@/lib/candidatePaywallEnv';
import { getSiteOrigin } from '@/lib/siteUrl';

const DEFAULT_AMOUNT_MXN = 49;

const sanitizeReturnPath = (raw: string | null): string => {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return '/buscar-candidatos';
  return s;
};

/** Short reference for display (not a secret). */
const checkoutRef = (candidateId: string) => {
  const tail = candidateId.replace(/-/g, '').slice(-10).toUpperCase();
  return `MYJ-${tail}`;
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

  const ref = useMemo(() => checkoutRef(candidateId), [candidateId]);

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
            checkout_ref: ref,
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
        <title>Checkout seguro | MyJob</title>
        <meta name="description" content="Completa el pago para desbloquear el contacto del candidato en MyJob." />
        <link rel="canonical" href={`${origin}/pago-candidato`} />
      </Helmet>

      {/* Stripe / MP–style top trust bar */}
      <div className="border-b border-border/60 bg-muted/30">
        <div className="container mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-2.5 text-xs text-muted-foreground sm:justify-between">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
            Conexión cifrada (HTTPS)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            El cobro lo procesa un proveedor certificado PCI
          </span>
        </div>
      </div>

      <div className="relative border-b border-border/40 bg-gradient-to-b from-muted/40 to-background pb-16 pt-8">
        <div className="container mx-auto max-w-3xl px-4">
          {/* Breadcrumb */}
          <nav className="mb-6 flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
            <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <Home className="h-3.5 w-3.5" />
              Inicio
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            <Link to={returnPath} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <Users className="h-3.5 w-3.5" />
              Candidatos
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            <span className="font-medium text-foreground">Pago</span>
          </nav>

          {/* Steps */}
          <ol className="mb-8 flex flex-wrap items-stretch justify-center gap-2 sm:gap-3" aria-label="Pasos del checkout">
            {(
              [
                { key: 'resumen', label: 'Resumen', state: 'done' as const },
                { key: 'pasarela', label: 'Pasarela', state: 'current' as const },
                { key: 'contacto', label: 'Contacto', state: 'todo' as const },
              ] as const
            ).map((step) => (
              <li key={step.key} className="flex min-w-[6.5rem] flex-1 sm:max-w-[9rem] sm:flex-initial">
                <div
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 ${
                    step.state === 'current'
                      ? 'border-primary/35 bg-primary/8 text-foreground shadow-sm'
                      : step.state === 'done'
                        ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground'
                        : 'border-border/50 bg-card/40 text-muted-foreground'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      step.state === 'current'
                        ? 'bg-primary text-primary-foreground'
                        : step.state === 'done'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                    {step.state === 'current' ? '2' : null}
                    {step.state === 'todo' ? '3' : null}
                  </span>
                  <span className="text-xs font-semibold sm:text-sm">{step.label}</span>
                </div>
              </li>
            ))}
          </ol>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Main checkout card */}
            <Card className="overflow-hidden rounded-2xl border-border/60 shadow-lg shadow-black/5">
              <div className="border-b border-border/60 bg-card px-6 py-4 sm:px-8">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MyJob · Checkout</p>
                    <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">Desbloquear contacto</h1>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                      Un pago único para solicitar el contacto de este candidato por WhatsApp. Tras completar el pago en la pasarela,
                      volverás a la lista y podrás abrir la conversación.
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 self-start font-mono text-xs font-normal">
                    Ref. {ref}
                  </Badge>
                </div>
              </div>

              <CardContent className="space-y-0 p-0 sm:p-0">
                {/* Line items — table-like */}
                <div className="px-6 py-5 sm:px-8">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detalle del pedido</p>
                  <div className="rounded-xl border border-border/60 bg-muted/15">
                    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-sm">
                      <span className="text-muted-foreground">Concepto</span>
                      <span className="text-right font-medium text-muted-foreground">Importe</span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-4 text-sm">
                      <div>
                        <p className="font-semibold text-foreground">Acceso al contacto del candidato</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Perfil: {roleLabel} · ID {candidateId.slice(0, 8)}…
                        </p>
                      </div>
                      <p className="self-center text-right font-semibold tabular-nums text-foreground">
                        ${amount.toFixed(2)} MXN
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="tabular-nums">${amount.toFixed(2)} MXN</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Impuestos (IVA u otros) y comisiones finales, si aplican, se mostrarán en la pasarela de pago antes de confirmar.
                    </p>
                    <Separator className="my-3" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-base font-bold text-foreground">Total estimado</span>
                      <span className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
                        ${amount.toFixed(2)} <span className="text-lg font-bold text-muted-foreground">MXN</span>
                      </span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Payment methods */}
                <div className="px-6 py-5 sm:px-8">
                  <p className="mb-1 text-sm font-semibold text-foreground">Medios de pago habituales en México</p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    En el siguiente paso verás la pantalla del proveedor con las opciones reales disponibles para tu cuenta y monto.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      { icon: CreditCard, title: 'Tarjeta', sub: 'Visa, Mastercard, AMEX' },
                      { icon: Building2, title: 'SPEI', sub: 'Transferencia bancaria' },
                      { icon: Store, title: 'Tiendas', sub: 'Donde aplique' },
                    ].map(({ icon: Icon, title, sub }) => (
                      <div
                        key={title}
                        className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 transition-colors hover:border-primary/25 hover:bg-muted/20"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" aria-hidden />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{title}</p>
                          <p className="text-xs text-muted-foreground">{sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/60 bg-muted/20 px-6 py-5 sm:px-8">
                  {error ? (
                    <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}

                  <Button
                    size="lg"
                    className="h-12 w-full rounded-xl text-base font-bold shadow-sm"
                    onClick={startCheckout}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Abriendo pasarela segura…
                      </>
                    ) : (
                      <>
                        Continuar con el pago
                        <ChevronRight className="ml-2 h-5 w-5" />
                      </>
                    )}
                  </Button>

                  <Button variant="ghost" asChild className="mt-2 w-full rounded-xl text-muted-foreground">
                    <Link to={returnPath} className="inline-flex items-center justify-center gap-2">
                      <ArrowLeft className="h-4 w-4" />
                      Volver a candidatos sin pagar
                    </Link>
                  </Button>

                  <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
                    Al continuar confirmas que has leído los{' '}
                    <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
                      Términos
                    </a>{' '}
                    y la{' '}
                    <a href="/refund-policy" className="underline underline-offset-2 hover:text-foreground">
                      Política de reembolsos
                    </a>
                    . El procesamiento del pago puede mostrarse en inglés según el proveedor.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Side help */}
            <aside className="space-y-4 lg:pt-2">
              <Card className="rounded-2xl border-border/60 bg-card/80 shadow-sm">
                <CardContent className="p-5 text-sm">
                  <p className="font-semibold text-foreground">¿Qué pasa después?</p>
                  <ul className="mt-3 space-y-2 text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                        1
                      </span>
                      <span>Se abre la pasarela en la misma ventana para autorizar el cobro.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                        2
                      </span>
                      <span>Al completarse, regresas a la lista con el acceso desbloqueado.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                        3
                      </span>
                      <span>Pulsa «Contactar ahora» en la tarjeta del candidato para abrir WhatsApp.</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
              <p className="px-1 text-xs text-muted-foreground">
                ¿Problemas con el pago? Escríbenos desde el enlace de contacto en el pie de página e indica la referencia{' '}
                <span className="font-mono text-foreground">{ref}</span>.
              </p>
            </aside>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export default PagoCandidato;
