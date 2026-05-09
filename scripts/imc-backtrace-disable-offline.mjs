/**
 * IMC / aggregator backtrace: probe original job URLs and deactivate local rows when source is clearly gone.
 *
 * Uses `jobs.b_same_as` when it is an http(s) URL, otherwise infers Indeed MX from `id` when `id` looks like a 16-char hex `jk`.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 * - IMC_BACKTRACE_BATCH=400          (page size per REST request)
 * - IMC_BACKTRACE_MAX_BATCHES=200    (safety cap; set higher for huge tables)
 * - IMC_BACKTRACE_TIMEOUT_MS=12000
 * - IMC_BACKTRACE_CONCURRENCY=6
 * - IMC_BACKTRACE_DRY_RUN=1
 * - IMC_BACKTRACE_PROBE_MODE=job-boards-only | all
 *     job-boards-only (default): only HTTP-fetch URLs that look like aggregator job pages (Indeed viewjob, LinkedIn /jobs/, etc.)
 *     all: probe any https `b_same_as` (legacy; may mis-handle employer homepages stored in b_same_as)
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

/** Avoid probing employer marketing sites in b_same_as — only aggregator job detail URLs. */
function isJobBoardProbeTarget(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (host.includes('indeed.') && (path.includes('/viewjob') || path.includes('/rc/clk') || u.searchParams.has('jk')))
      return true;
    if (host.endsWith('linkedin.com') && path.includes('/jobs/')) return true;
    if (host.includes('glassdoor.') && path.includes('/job/')) return true;
    if (host.includes('computrabajo.com') && path.includes('/oferta-de-trabajo')) return true;
    if (host.includes('occ.com.mx') && path.includes('/empleo')) return true;
    if (host.includes('bumeran.com') && path.includes('/empleos')) return true;
    if (host.includes('talent.com') && path.includes('/view')) return true;

    return false;
  } catch {
    return false;
  }
}

function shouldProbe(url, mode) {
  if (mode === 'all') return /^https?:\/\//i.test(String(url || '').trim());
  return isJobBoardProbeTarget(url);
}

async function restSelectActiveJobsPage(baseUrl, key, batch, offset) {
  const url = new URL(`${stripTrailingSlash(baseUrl)}/rest/v1/jobs`);
  url.searchParams.set('select', 'id,title,b_same_as,is_active');
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', String(batch));
  url.searchParams.set('offset', String(offset));
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
    body.includes('job expired') ||
    body.includes('expired job') ||
    body.includes('no longer available') ||
    body.includes('this job has been removed') ||
    body.includes('job no longer available') ||
    body.includes('job is no longer available') ||
    body.includes('this job is no longer') ||
    body.includes('job posting has been removed') ||
    body.includes('lo sentimos, pero este empleo ya no está disponible') ||
    body.includes('este empleo ya no está disponible') ||
    body.includes('esta vacante ya no está disponible') ||
    body.includes('empleo ya no está disponible') ||
    body.includes('la oferta de trabajo ya no está disponible') ||
    body.includes('vaga não está mais disponível') ||
    body.includes('offer expired') ||
    body.includes('position filled')
  );
}

async function probeUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; MyJobBacktrace/1.1; +https://myjob.mx) AppleWebKit/537.36 (KHTML, like Gecko)',
        'accept-language': 'es-MX,es;q=0.9,en;q=0.8',
      },
    });

    if (offlineByHttpStatus(res.status)) {
      return { offline: true, reason: `status:${res.status}`, status: res.status };
    }

    // Some sources reject bots with 403/429; treat as unknown — do not deactivate.
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

function encodeInList(ids) {
  return ids.map((id) => `"${String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
}

async function disableJobs(baseUrl, key, ids) {
  if (ids.length === 0) return;
  const chunkSize = 120;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const url = `${stripTrailingSlash(baseUrl)}/rest/v1/jobs?id=in.(${encodeInList(slice)})`;
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
}

async function main() {
  const supabaseUrl = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const batch = parseIntEnv('IMC_BACKTRACE_BATCH', 400);
  const maxBatches = parseIntEnv('IMC_BACKTRACE_MAX_BATCHES', 200);
  const timeoutMs = parseIntEnv('IMC_BACKTRACE_TIMEOUT_MS', 12000);
  const concurrency = parseIntEnv('IMC_BACKTRACE_CONCURRENCY', 6);
  const dryRun = String(process.env.IMC_BACKTRACE_DRY_RUN || '').trim() === '1';
  const probeModeRaw = String(process.env.IMC_BACKTRACE_PROBE_MODE || 'job-boards-only').trim().toLowerCase();
  const probeMode = probeModeRaw === 'all' ? 'all' : 'job-boards-only';

  const offline = [];
  const skipped = [];
  let totalRows = 0;
  let totalProbeable = 0;
  let batches = 0;

  for (let b = 0; b < maxBatches; b++) {
    const offset = b * batch;
    const rows = await restSelectActiveJobsPage(supabaseUrl, serviceRoleKey, batch, offset);
    if (!Array.isArray(rows) || rows.length === 0) break;
    batches += 1;
    totalRows += rows.length;

    const candidates = rows
      .map((job) => ({ ...job, source_url: inferSourceUrl(job) }))
      .filter((job) => /^https?:\/\//i.test(String(job.source_url || '')))
      .filter((job) => shouldProbe(job.source_url, probeMode));

    totalProbeable += candidates.length;

    await runPool(candidates, concurrency, async (job) => {
      const r = await probeUrl(job.source_url, timeoutMs);
      if (r.offline) {
        offline.push({ id: job.id, source_url: job.source_url, reason: r.reason, status: r.status });
      } else if (r.reason.startsWith('blocked:') || r.reason.startsWith('error:')) {
        skipped.push({ id: job.id, source_url: job.source_url, reason: r.reason });
      }
    });

    if (rows.length < batch) break;
  }

  if (!dryRun && offline.length > 0) {
    await disableJobs(supabaseUrl, serviceRoleKey, offline.map((x) => x.id));
  }

  console.log(
    JSON.stringify(
      {
        batches_scanned: batches,
        scanned_active_rows: totalRows,
        probe_mode: probeMode,
        with_probeable_source_url: totalProbeable,
        disable_count: offline.length,
        skipped_count: skipped.length,
        dry_run: dryRun,
        sample_disabled: offline.slice(0, 30),
        sample_skipped: skipped.slice(0, 30),
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
