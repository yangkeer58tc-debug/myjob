#!/usr/bin/env node
/**
 * Read-only snapshot of the external resume library (RMC Supabase).
 *
 * Loads env from project root files (later overrides earlier):
 *   .env → .env.local → .env.staging
 * Plus optional: --env-file <path> (loaded last)
 *
 * Required (same as frontend):
 *   VITE_RESUMES_SUPABASE_URL
 *   VITE_RESUMES_SUPABASE_ANON_KEY
 *
 * Optional:
 *   VITE_RESUMES_PUBLIC_VIEW  (default: public_candidates)
 *
 * Usage:
 *   npm run resume:fetch -- --limit 200 --out ./tmp/resumes.csv
 *   npm run resume:fetch -- --env-file .env.staging --signed-urls --limit 50
 *
 * Notes:
 *   - Uses only .select() (read). No writes.
 *   - Column set is auto-downgraded if PostgREST reports missing columns.
 *   - --signed-urls may fail under anon RLS; empty cell means no URL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { limit: 2000, outPath: '', envFile: '', signedUrls: false, successOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      out.limit = Math.max(1, Math.min(50_000, parseInt(String(argv[++i]), 10) || 2000));
    } else if (a === '--out' && argv[i + 1]) {
      out.outPath = String(argv[++i]).trim();
    } else if (a === '--env-file' && argv[i + 1]) {
      out.envFile = String(argv[++i]).trim();
    } else if (a === '--signed-urls') {
      out.signedUrls = true;
    } else if (a === '--parse-success-only') {
      out.successOnly = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function applyEnvLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const eq = t.indexOf('=');
  if (eq <= 0) return;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
    val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  if (key) process.env[key] = val;
}

function loadEnvFile(abs) {
  if (!abs || !fs.existsSync(abs)) return;
  const text = fs.readFileSync(abs, 'utf8');
  for (const line of text.split(/\r?\n/)) applyEnvLine(line);
}

function loadStandardEnvFiles(extraAbs) {
  const candidates = [
    path.join(ROOT, '.env'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, '.env.staging'),
  ];
  for (const p of candidates) loadEnvFile(p);
  if (extraAbs) loadEnvFile(path.isAbsolute(extraAbs) ? extraAbs : path.join(ROOT, extraAbs));
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLUMN_SETS = [
  'id,name,first_name,last_name,job_direction,profile_summary,whatsapp,phone,email,storage_bucket,storage_path,parse_status,country,city,work_years,created_at,updated_at',
  'id,name,first_name,last_name,job_direction,profile_summary,whatsapp,phone,email,created_at,updated_at',
  'id,name,first_name,last_name,job_direction,profile_summary,whatsapp,phone,updated_at,created_at',
  'id,name,first_name,last_name,job_direction,profile_summary,updated_at,created_at',
];

async function fetchAllRows(sb, table, cols, { limit, successOnly }) {
  const maxPage = 500;
  const rows = [];
  let from = 0;
  for (;;) {
    if (rows.length >= limit) break;
    const remaining = limit - rows.length;
    const take = Math.min(maxPage, remaining);
    const to = from + take - 1;
    let q = sb
      .from(table)
      .select(cols)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (successOnly) q = q.eq('parse_status', 'success');
    const { data, error } = await q;
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < take) break;
    from = to + 1;
    if (from > 100_000) break;
  }
  return rows.slice(0, limit);
}

async function trySignedUrl(sb, row) {
  const bucket = String(row.storage_bucket || '').trim();
  const sp = String(row.storage_path || '').trim();
  if (!bucket || !sp) return '';
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(sp, 60 * 60 * 24);
  if (error || !data?.signedUrl) return '';
  return data.signedUrl;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/fetch-resumes-readonly.mjs [options]

Options:
  --limit N                 Max rows (default 2000, cap 50000)
  --out path.csv            Write CSV; default prints TSV to stdout
  --env-file path           Load this dotenv file after .env / .env.local / .env.staging
  --signed-urls             Try createSignedUrl per row (may fail under anon RLS)
  --parse-success-only      Only rows with parse_status = success (if column exists)
`);
    process.exit(0);
  }

  loadStandardEnvFiles(args.envFile);

  const url = String(process.env.VITE_RESUMES_SUPABASE_URL || '').trim();
  const key = String(process.env.VITE_RESUMES_SUPABASE_ANON_KEY || '').trim();
  const table = String(process.env.VITE_RESUMES_PUBLIC_VIEW || 'public_candidates').trim() || 'public_candidates';

  if (!url || !key) {
    console.error(
      '[resume:fetch] Missing VITE_RESUMES_SUPABASE_URL or VITE_RESUMES_SUPABASE_ANON_KEY.\n' +
        'Add them to .env or .env.staging in the project root, then re-run.',
    );
    process.exit(2);
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let cols = COLUMN_SETS[0];
  let rows = [];
  for (let attempt = 0; attempt < COLUMN_SETS.length; attempt++) {
    cols = COLUMN_SETS[attempt];
    try {
      rows = await fetchAllRows(sb, table, cols, {
        limit: args.limit,
        successOnly: args.successOnly,
      });
      if (attempt > 0) {
        console.error(`[resume:fetch] Using reduced column set (attempt ${attempt + 1}).`);
      }
      break;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const missingCol =
        /column/i.test(msg) && (/does not exist|not find|schema cache/i.test(msg) || /42703/.test(msg));
      if (!missingCol || attempt === COLUMN_SETS.length - 1) {
        console.error('[resume:fetch] Query failed:', msg);
        process.exit(3);
      }
    }
  }

  let signedCol = [];
  if (args.signedUrls && rows.length) {
    signedCol = await Promise.all(
      rows.map(async (row) => {
        try {
          return await trySignedUrl(sb, row);
        } catch {
          return '';
        }
      }),
    );
  }

  const headers = args.signedUrls
    ? [...cols.split(','), 'resume_signed_url_24h']
    : cols.split(',');

  const lines = [headers.join(',')];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vals = headers.map((h) => {
      if (h === 'resume_signed_url_24h') return signedCol[i] || '';
      return row[h] ?? '';
    });
    lines.push(vals.map(csvEscape).join(','));
  }
  const body = lines.join('\n');

  if (args.outPath) {
    const abs = path.isAbsolute(args.outPath) ? args.outPath : path.join(ROOT, args.outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    console.error(`[resume:fetch] Wrote ${rows.length} rows → ${abs}`);
  } else {
    process.stdout.write(body);
    if (!body.endsWith('\n')) process.stdout.write('\n');
    console.error(`[resume:fetch] Printed ${rows.length} rows to stdout`);
  }
}

main().catch((e) => {
  console.error('[resume:fetch] Fatal:', e);
  process.exit(1);
});
