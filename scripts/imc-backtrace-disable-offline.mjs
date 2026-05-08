/**
 * Daily IMC backtrace checker:
 * - find active jobs likely imported from aggregators (b_same_as/origin url),
 * - probe source URL status,
 * - disable local jobs when source is clearly offline.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 * - IMC_BACKTRACE_LIMIT=300
 * - IMC_BACKTRACE_TIMEOUT_MS=12000
 * - IMC_BACKTRACE_CONCURRENCY=6
 * - IMC_BACKTRACE_DRY_RUN=1
 */

function required(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}

function parseIntEnv(name, fallback) {
  const raw = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function isLikelyIndeedJk(id) {
  return /^[a-f0-9]{16}$/i.test(String(id || '').trim());
}

function inferSourceUrl(job) {
  const sameAs = String(job.b_same_as || '').trim();
  if (/^https?:\/\//i.test(sameAs)) return sameAs;
  if (isLikelyIndeedJk(job.id)) return `https://mx.indeed.com/viewjob?jk=${String(job.id).toLowerCase()}`;
  return '';
}

async function restSelectActiveJobs(baseUrl, key, limit) {
  const url = new URL(`${stripTrailingSlash(baseUrl)}/rest/v1/jobs`);
  url.searchParams.set('select', 'id,title,b_same_as,is_active');
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Select jobs failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function offlineByHttpStatus(status) {
  return status === 404 || status === 410 || status === 451;
}

function offlineByBody(text) {
  const body = String(text || '').toLowerCase();
  return (
    body.includes('job has expired') ||
    body.includes('no longer available') ||
    body.includes('this job has been removed') ||
    body.includes('vaga não está mais disponível') ||
    body.includes('esta vacante ya no está disponible') ||
    body.includes('empleo ya no está disponible')
  );
}

async function probeUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'myjob-imc-backtrace/1.0' },
    });

    if (offlineByHttpStatus(res.status)) {
      return { offline: true, reason: `status:${res.status}`, status: res.status };
    }

    // Some sources reject bots with 403/429; these are unknown, not offline.
    if (res.status === 403 || res.status === 429) {
      return { offline: false, reason: `blocked:${res.status}`, status: res.status };
    }

    const body = await res.text();
    if (offlineByBody(body)) {
      return { offline: true, reason: 'body:offline-marker', status: res.status };
    }
    return { offline: false, reason: `status:${res.status}`, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { offline: false, reason: `error:${msg}`, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const threads = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(threads);
}

async function disableJobs(baseUrl, key, ids) {
  if (ids.length === 0) return;
  const url = `${stripTrailingSlash(baseUrl)}/rest/v1/jobs?id=in.(${ids.map((x) => `"${x}"`).join(',')})`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      Prefer: 'return=minimal',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ is_active: false }),
  });
  if (!res.ok) throw new Error(`Disable jobs failed (${res.status}): ${await res.text()}`);
}

async function main() {
  const supabaseUrl = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const limit = parseIntEnv('IMC_BACKTRACE_LIMIT', 300);
  const timeoutMs = parseIntEnv('IMC_BACKTRACE_TIMEOUT_MS', 12000);
  const concurrency = parseIntEnv('IMC_BACKTRACE_CONCURRENCY', 6);
  const dryRun = String(process.env.IMC_BACKTRACE_DRY_RUN || '').trim() === '1';

  const rows = await restSelectActiveJobs(supabaseUrl, serviceRoleKey, limit);
  const candidates = rows
    .map((job) => ({ ...job, source_url: inferSourceUrl(job) }))
    .filter((job) => /^https?:\/\//i.test(String(job.source_url || '')));

  const offline = [];
  const skipped = [];
  await runPool(candidates, concurrency, async (job) => {
    const r = await probeUrl(job.source_url, timeoutMs);
    if (r.offline) {
      offline.push({ id: job.id, source_url: job.source_url, reason: r.reason, status: r.status });
    } else if (r.reason.startsWith('blocked:') || r.reason.startsWith('error:')) {
      skipped.push({ id: job.id, source_url: job.source_url, reason: r.reason });
    }
  });

  if (!dryRun && offline.length > 0) {
    const ids = offline.map((x) => x.id);
    // keep request size bounded
    const chunk = 150;
    for (let i = 0; i < ids.length; i += chunk) {
      await disableJobs(supabaseUrl, serviceRoleKey, ids.slice(i, i + chunk));
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned_active_rows: rows.length,
        with_source_url: candidates.length,
        disable_count: offline.length,
        skipped_count: skipped.length,
        dry_run: dryRun,
        sample_disabled: offline.slice(0, 20),
        sample_skipped: skipped.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
