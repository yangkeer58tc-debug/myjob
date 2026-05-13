import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Building2, ChevronLeft, CreditCard, Loader2, Lock, Shield } from 'lucide-react';
import PublicLayout from '@/components/PublicLayout';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { isCandidatePaywallEnabled } from '@/lib/candidatePaywallEnv';
import { getSiteOrigin } from '@/lib/siteUrl';

const DEFAULT_AMOUNT_MXN = 49;

const sanitizeReturnPath = (raw: string | null): string => {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return '/buscar-candidatos';
  return s;
};

const checkoutRef = (candidateId: string) => {
  const tail = candidateId.replace(/-/g, '').slice(-10).toUpperCase();
  return `MYJ-${tail}`;
};

/**
 * Airwallex in Mexico (Hosted Payment Page): typically international & local cards,
 * plus SPEI for bank transfer where enabled on the merchant account.
 * @see https://www.airwallex.com/docs/payments__north-america-and-latam
 */
const MX_AIRWALLEX_METHODS = [
  {
    id: 'card',
    title: 'Tarjeta',
    desc: 'Visa, Mastercard, American Express y otras habilitadas en tu cuenta.',
    icon: CreditCard,
  },
  {
    id: 'spei',
    title: 'SPEI',
    desc: 'Transferencia bancaria en línea (se elige y completa en la pasarela de Airwallex).',
    icon: Building2,
  },
] as const;

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
        <title>Pago | MyJob</title>
        <meta name="description" content="Completa el pago para desbloquear el contacto del candidato en MyJob." />
        <link rel="canonical" href={`${origin}/pago-candidato`} />
      </Helmet>

      <div className="min-h-[60vh] border-b border-border/40 bg-muted/20 py-10 md:py-14">
        <div className="container mx-auto max-w-3xl px-4">
          {/* OPtell-style: split card, no outer chrome overload */}
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xl shadow-black/8 md:flex md:min-h-[420px]">
            {/* Left: summary (gradient) */}
            <div className="relative flex w-full flex-col justify-between bg-gradient-to-br from-fuchsia-600 via-purple-600 to-violet-900 p-8 text-white md:w-[44%] md:min-w-[280px] md:p-9">
              <div>
                <p className="text-sm font-semibold tracking-tight text-white/90">MyJob</p>
                <h1 className="mt-2 text-2xl font-extrabold leading-tight md:text-[1.65rem]">Desbloquear contacto</h1>
                <p className="mt-2 text-sm text-white/80">Pago único · acceso al flujo de WhatsApp para este candidato.</p>
                <p className="mt-3 font-mono text-xs text-white/60">Ref. {ref}</p>
              </div>

              <div className="mt-8 space-y-4">
                <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/70">Facturación</p>
                  <div className="mt-2 flex items-baseline justify-between gap-2 border-b border-white/15 pb-3">
                    <span className="text-sm text-white/90">Contacto candidato · {roleLabel}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-sm text-white/80">Total</span>
                    <span className="text-3xl font-extrabold tabular-nums tracking-tight">
                      ${amount.toFixed(2)}{' '}
                      <span className="text-lg font-bold text-white/85">MXN</span>
                    </span>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-white/65">
                  IVA u otros cargos, si aplican, se confirman en la pasarela antes de pagar. Para reembolsos consulta la{' '}
                  <a href="/refund-policy" className="underline underline-offset-2 hover:text-white">
                    política de reembolsos
                  </a>
                  .
                </p>
              </div>
            </div>

            {/* Right: payment panel */}
            <div className="flex flex-1 flex-col bg-background p-8 md:p-9">
              <Link
                to={returnPath}
                className="mb-6 inline-flex w-fit items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Volver
              </Link>

              <h2 className="text-lg font-bold text-foreground">Completar pago</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Continuarás en la{' '}
                <span className="font-medium text-foreground">página segura de Airwallex</span>. Ahí eliges el medio y autorizas el cobro (no ingresamos datos de tarjeta en MyJob).
              </p>

              <div className="mt-6 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Medios habituales en México con Airwallex
                </p>
                <ul className="space-y-2">
                  {MX_AIRWALLEX_METHODS.map(({ id, title, desc, icon: Icon }) => (
                    <li
                      key={id}
                      className="flex gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm">
                        <Icon className="h-5 w-5 text-primary" aria-hidden />
                      </span>
                      <span>
                        <span className="font-semibold text-foreground">{title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Otros métodos solo aparecen si tu cuenta Airwallex los tiene activos para México.
                </p>
              </div>

              <div className="mt-6 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  El procesamiento lo realiza Airwallex (PCI). MyJob no almacena datos de tarjeta.
                </span>
              </div>

              {error ? (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="mt-auto flex flex-col gap-3 pt-8">
                <Button
                  size="lg"
                  className="h-12 w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-700 text-base font-bold text-white shadow-md hover:from-fuchsia-700 hover:to-violet-800"
                  onClick={startCheckout}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Abriendo pasarela…
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2 h-4 w-4 opacity-90" aria-hidden />
                      Pagar ${amount.toFixed(2)} MXN
                    </>
                  )}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Al pagar aceptas los{' '}
                  <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
                    términos
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};

export default PagoCandidato;
