// Scheduled ingest relay — runs in GitHub Actions, NOT in the worker.
// The Bank's IADB endpoint sits behind Akamai and 403s datacentre egress IPs
// (including Cloudflare workers); GitHub-hosted runners get through with a
// browser User-Agent. Fetches the full history for every series and POSTs the
// raw CSVs to the worker's /admin/ingest, which parses and stores them.
//
//   ADMIN_TOKEN=... node scripts/ingest.mjs [worker-base-url]
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Reuse the worker's own series list and URL builder — no drift.
const outDir = mkdtempSync(join(tmpdir(), 'rates-ingest-'));
const bundle = join(outDir, 'worker.mjs');
execSync(`npx esbuild src/index.ts --bundle --format=esm --platform=node --outfile=${bundle}`, {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'pipe',
});
const { buildCsvUrl, QUOTED_SERIES, BANK_RATE } = await import(bundle);

const WORKER = process.argv[2] ?? 'https://uk-mortgage-rates.nanoluke521.workers.dev';
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error('ADMIN_TOKEN env var required');
  process.exit(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ddMonYyyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
const FROM = '01/Jan/2016';
const TO = ddMonYyyy(new Date());

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchCsv(codes) {
  const url = buildCsvUrl(codes, FROM, TO);
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/csv,*/*' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`IADB ${res.status} for ${codes.join(',')}: ${text.slice(0, 200)}`);
  if (!/^"?DATE/i.test(text.trim())) throw new Error(`unexpected IADB payload for ${codes.join(',')}: ${text.slice(0, 200)}`);
  console.log(`fetched ${codes.length} series: ${text.split('\n').length} rows`);
  return text;
}

const csvs = [await fetchCsv(QUOTED_SERIES.map((s) => s.code)), await fetchCsv([BANK_RATE.code])];

const res = await fetch(`${WORKER}/admin/ingest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ csvs }),
});
const body = await res.text();
console.log(`ingest → ${res.status} ${body}`);
if (!res.ok) process.exit(1);
const parsed = JSON.parse(body);
if (parsed.missing?.length) {
  console.error(`series missing from IADB response: ${parsed.missing.join(', ')}`);
  process.exit(1);
}
