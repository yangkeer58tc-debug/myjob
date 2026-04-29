/**
 * Sync sample production data into staging.
 *
 * Default behavior:
 * - Copy 10 active jobs from PROD -> STAGING public.jobs
 * - Copy 10 public candidates from PROD -> STAGING public.candidates
 *
 * Optional behavior:
 * - If PROD_RESUMES_* and STAGING_RESUMES_* are provided, copy 10 resumes
 *   from PRODUCTION resumes source table/view to STAGING resumes table.
 *
 * Required env for core sync:
 * - PROD_SUPABASE_URL
 * - PROD_SUPABASE_KEY                 (anon or service role; needs read access)
 * - STAGING_SUPABASE_URL
 * - STAGING_SUPABASE_SERVICE_ROLE_KEY (must bypass RLS for upsert)
 */

const LIMIT = Number.parseInt(process.env.SYNC_LIMIT || "10", 10);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, "");
}

async function restSelect({ baseUrl, key, tableOrView, select = "*", filters = [], order, limit }) {
  const url = new URL(`${stripTrailingSlash(baseUrl)}/rest/v1/${tableOrView}`);
  url.searchParams.set("select", select);
  for (const [k, v] of filters) url.searchParams.set(k, v);
  if (order) url.searchParams.set("order", order);
  if (limit) url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SELECT ${tableOrView} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function restUpsert({ baseUrl, key, table, rows }) {
  if (!rows.length) return { inserted: 0 };
  const url = `${stripTrailingSlash(baseUrl)}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPSERT ${table} failed (${res.status}): ${text}`);
  }
  return { inserted: rows.length };
}

async function syncJobsAndCandidates() {
  const prodUrl = required("PROD_SUPABASE_URL");
  const prodKey = required("PROD_SUPABASE_KEY");
  const stagingUrl = required("STAGING_SUPABASE_URL");
  const stagingServiceRole = required("STAGING_SUPABASE_SERVICE_ROLE_KEY");

  const jobs = await restSelect({
    baseUrl: prodUrl,
    key: prodKey,
    tableOrView: "jobs",
    filters: [["is_active", "eq.true"]],
    order: "created_at.desc",
    limit: LIMIT,
  });
  await restUpsert({
    baseUrl: stagingUrl,
    key: stagingServiceRole,
    table: "jobs",
    rows: jobs,
  });

  const candidates = await restSelect({
    baseUrl: prodUrl,
    key: prodKey,
    tableOrView: "candidates",
    filters: [["is_public", "eq.true"]],
    order: "created_at.desc",
    limit: LIMIT,
  });
  await restUpsert({
    baseUrl: stagingUrl,
    key: stagingServiceRole,
    table: "candidates",
    rows: candidates,
  });

  return { jobs: jobs.length, candidates: candidates.length };
}

async function syncResumesIfConfigured() {
  const prodResumesUrl = String(process.env.PROD_RESUMES_SUPABASE_URL || "").trim();
  const prodResumesKey = String(process.env.PROD_RESUMES_SUPABASE_KEY || "").trim();
  const stagingResumesUrl = String(process.env.STAGING_RESUMES_SUPABASE_URL || "").trim();
  const stagingResumesServiceRole = String(process.env.STAGING_RESUMES_SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!prodResumesUrl || !prodResumesKey || !stagingResumesUrl || !stagingResumesServiceRole) {
    return { enabled: false, count: 0 };
  }

  const source = String(process.env.PROD_RESUMES_SOURCE || "public_candidates").trim();
  const target = String(process.env.STAGING_RESUMES_TARGET || "public_candidates").trim();
  const order = String(process.env.RESUMES_ORDER || "created_at.desc").trim();

  const resumes = await restSelect({
    baseUrl: prodResumesUrl,
    key: prodResumesKey,
    tableOrView: source,
    order,
    limit: LIMIT,
  });
  await restUpsert({
    baseUrl: stagingResumesUrl,
    key: stagingResumesServiceRole,
    table: target,
    rows: resumes,
  });
  return { enabled: true, count: resumes.length, source, target };
}

async function main() {
  const core = await syncJobsAndCandidates();
  const resumes = await syncResumesIfConfigured();

  console.log("Sync done:");
  console.log(`- jobs -> staging.jobs: ${core.jobs}`);
  console.log(`- candidates -> staging.candidates: ${core.candidates}`);
  if (resumes.enabled) {
    console.log(`- resumes -> ${resumes.target}: ${resumes.count} (source: ${resumes.source})`);
  } else {
    console.log("- resumes sync skipped (PROD_RESUMES_* or STAGING_RESUMES_* not fully provided)");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
