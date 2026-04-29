// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type AirwallexAuthResponse = {
  token?: string;
};

type AirwallexIntentResponse = {
  id?: string;
  payment_intent_id?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

const AIRWALLEX_BASE_URL =
  Deno.env.get('AIRWALLEX_BASE_URL')?.trim() || 'https://api-demo.airwallex.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const clientId = Deno.env.get('AIRWALLEX_CLIENT_ID')?.trim();
  const apiKey = Deno.env.get('AIRWALLEX_API_KEY')?.trim();

  if (!clientId || !apiKey) {
    return json(
      {
        error:
          'Missing Airwallex credentials. Please set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY in Supabase Edge Function secrets.',
      },
      500,
    );
  }

  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const candidateId = String(payload.candidateId || '').trim();
    const currency = String(payload.currency || 'MXN').toUpperCase();
    const amountRaw = Number(payload.amount || 0);
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0;
    const returnUrl = String(payload.returnUrl || '').trim();
    const cancelUrl = String(payload.cancelUrl || '').trim();
    const locale = String(payload.locale || 'es-MX').trim();
    const metadata =
      payload.metadata && typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : {};

    if (!candidateId || !returnUrl || !cancelUrl || amount <= 0) {
      return json(
        {
          error: 'Invalid parameters. candidateId, amount, returnUrl and cancelUrl are required.',
        },
        400,
      );
    }

    const requestId = crypto.randomUUID();

    const authRes = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({}),
    });
    if (!authRes.ok) {
      const errText = await authRes.text();
      return json(
        { error: `Airwallex auth failed (${authRes.status}). ${errText || ''}`.trim() },
        502,
      );
    }
    const authData = (await authRes.json()) as AirwallexAuthResponse;
    const token = String(authData.token || '').trim();
    if (!token) return json({ error: 'Airwallex auth succeeded but token missing.' }, 502);

    const merchantOrderId = `candidate_${candidateId}_${Date.now()}`;

    const intentRes = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        amount,
        currency,
        merchant_order_id: merchantOrderId,
        return_url: returnUrl,
        order: {
          products: [
            {
              name: 'Unlock candidate contact',
              desc: `Unlock candidate ${candidateId}`,
              quantity: 1,
              unit_price: amount,
            },
          ],
        },
        metadata: {
          ...metadata,
          candidate_id: candidateId,
          cancel_url: cancelUrl,
        },
      }),
    });

    if (!intentRes.ok) {
      const errText = await intentRes.text();
      return json(
        { error: `Create payment intent failed (${intentRes.status}). ${errText || ''}`.trim() },
        502,
      );
    }
    const intentData = (await intentRes.json()) as AirwallexIntentResponse;
    const intentId = String(intentData.id || intentData.payment_intent_id || '').trim();
    if (!intentId) return json({ error: 'Payment intent created but id missing.' }, 502);

    const linkRes = await fetch(
      `${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/${intentId}/generate_payment_link`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          return_url: returnUrl,
          cancel_url: cancelUrl,
          locale,
        }),
      },
    );

    if (!linkRes.ok) {
      const errText = await linkRes.text();
      return json(
        { error: `Generate payment link failed (${linkRes.status}). ${errText || ''}`.trim() },
        502,
      );
    }

    const linkData = (await linkRes.json()) as Record<string, any>;
    const checkoutUrl = String(
      linkData.payment_link ||
        linkData.url ||
        linkData.data?.url ||
        linkData.links?.[0]?.url ||
        '',
    ).trim();

    if (!checkoutUrl) {
      return json({ error: 'Payment link generated but checkoutUrl is empty.', raw: linkData }, 502);
    }

    return json({
      checkoutUrl,
      intentId,
      merchantOrderId,
    });
  } catch (error) {
    return json(
      {
        error: `Unexpected error: ${String((error as { message?: unknown })?.message || error)}`,
      },
      500,
    );
  }
});
