// Worker tests: bundles src, runs ingest + the full API surface against an
// in-memory KV with IADB-format CSV fixtures (the real IADB endpoint rejects
// datacentre IPs, so fixtures mirror its exact CSVF=TN&UsingCodes=Y shape).
//
//   node test/run.mjs
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const outDir = mkdtempSync(join(tmpdir(), 'rates-test-'));
const bundle = join(outDir, 'worker.mjs');
execSync(`npx esbuild src/index.ts --bundle --format=esm --platform=node --outfile=${bundle}`, {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'inherit',
});
const worker = await import(bundle);
const { QUOTED_SERIES, BANK_RATE, ATTRIBUTION } = worker;

class MockKV {
  store = new Map();
  async get(key, type) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// --- parser units -------------------------------------------------------------
check('parseBoeDate "31 Jan 2026"', worker.parseBoeDate('31 Jan 2026') === '2026-01-31');
check('parseBoeDate "5 Jun 2026" pads', worker.parseBoeDate('5 Jun 2026') === '2026-06-05');
check('parseBoeDate rejects junk', worker.parseBoeDate('not a date') === null);
check('parseBoeDate passes ISO through', worker.parseBoeDate('2026-05-31') === '2026-05-31');
check(
  'buildCsvUrl pins the IADB query contract',
  worker.buildCsvUrl(['IUMBV34', 'IUDBEDR'], '01/Jan/2016', '05/Jul/2026') ===
    'https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?' +
      'csv.x=yes&Datefrom=01%2FJan%2F2016&Dateto=05%2FJul%2F2026&SeriesCodes=IUMBV34%2CIUDBEDR&CSVF=TN&UsingCodes=Y',
);

// --- fixtures in the IADB CSV shape -------------------------------------------
const quotedCodes = QUOTED_SERIES.map((s) => s.code);
const quotedCsv = [
  `DATE,${quotedCodes.join(',')}`,
  // one missing cell (blank) and one ".." — both must be skipped, not zeroed
  `30 Apr 2026,${quotedCodes.map((c, i) => (i === 3 ? '' : (4 + i / 10).toFixed(2))).join(',')}`,
  `31 May 2026,${quotedCodes.map((c, i) => (i === 5 ? '..' : (4.1 + i / 10).toFixed(2))).join(',')}`,
].join('\n');

const bankRateCsv = [
  `DATE,${BANK_RATE.code}`,
  '01 Jun 2026,4.25',
  '18 Jun 2026,4.00', // MPC cut on 18 Jun...
  '19 Jun 2026,4.00',
  '03 Jul 2026,4.00', // ...held since
].join('\n');

const parsed = worker.parseBoeCsv(quotedCsv);
check('parser returns every quoted series', quotedCodes.every((c) => parsed[c]));
check('blank cell skipped', parsed[quotedCodes[3]].length === 1);
check('".." cell skipped', parsed[quotedCodes[5]].length === 1);
check('values land on the right series/date', parsed.IUMBV34?.find((p) => p.date === '2026-05-31')?.value === 4.2);
check('points sorted ascending', parsed[quotedCodes[0]].every((p, i, a) => i === 0 || a[i - 1].date <= p.date));

// --- ingest via the admin endpoint ---------------------------------------------
const env = { RATES_KV: new MockKV(), ADMIN_TOKEN: 'test-token' };
const now = new Date('2026-07-05T12:00:00Z');
const post = (token, body) =>
  worker.handleRequest(
    new Request('https://x/admin/ingest', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
    env,
    now,
  );

check('ingest rejects missing token', (await post(null, { csvs: [quotedCsv] })).status === 401);
check('ingest rejects wrong token', (await post('nope', { csvs: [quotedCsv] })).status === 401);
check('ingest rejects empty body', (await post('test-token', {})).status === 400);
check('ingest 422s when no expected series present', (await post('test-token', { csvs: ['DATE,XXX\n31 May 2026,1'] })).status === 422);

const ingestRes = await post('test-token', { csvs: [quotedCsv, bankRateCsv] });
const ingestBody = await ingestRes.json();
check('ingest succeeds with both CSVs', ingestRes.status === 200 && ingestBody.ok === true);
check('all 11 series ingested', ingestBody.ingested.length === 11, ingestBody.ingested.join(','));
check('nothing missing', ingestBody.missing.length === 0);

// --- read API -------------------------------------------------------------------
const get = (path) => worker.handleRequest(new Request(`https://x${path}`), env, now);

const rates = await (await get('/rates')).json();
check('/rates serves all series', rates.rates.length === 11);
check('/rates asOf is newest monthly observation', rates.asOf === '2026-05-31');
check('/rates carries OGL attribution', rates.attribution === ATTRIBUTION);
check(
  '/rates 2yr 75% LTV latest value is the May observation',
  rates.rates.find((r) => r.code === 'IUMBV34')?.value === 4.2,
);
check(
  'revert-to-rate series present with ex-SVR label',
  /revert/i.test(rates.rates.find((r) => r.code === 'IUMTLMV')?.label ?? ''),
);

const hist = await (await get('/rates/history?series=iumbv34')).json();
check('/rates/history case-insensitive lookup', hist.code === 'IUMBV34' && hist.points.length === 2);
check('/rates/history attribution', hist.attribution === ATTRIBUTION);
check('/rates/history unknown series → 400', (await get('/rates/history?series=NOPE')).status === 400);
check('/rates/history missing param → 400', (await get('/rates/history')).status === 400);

const base = await (await get('/baserate')).json();
check('/baserate serves the last observation', base.rate === 4.0 && base.asOf === '2026-07-03');
check('/baserate effectiveDate is the change date', base.effectiveDate === '2026-06-18');
check('/baserate next MPC from 2026-07-05 is 6 Aug', base.nextMpcDate === '2026-08-06');
check('/baserate lists the MPC calendar', Array.isArray(base.mpcDates) && base.mpcDates.length >= 8);
check('/baserate attribution', base.attribution === ATTRIBUTION);

// --- partial re-ingest must not wipe other series --------------------------------
const cut = [`DATE,${BANK_RATE.code}`, '04 Jul 2026,3.75'].join('\n');
await post('test-token', { csvs: [cut] });
const after = await (await get('/rates')).json();
check('partial ingest keeps quoted rates', after.rates.length === 11);
check('partial ingest updates bank rate', after.rates.find((r) => r.code === 'IUDBEDR')?.value === 3.75);

const status = await (await get('/status')).json();
check('/status logs the last ingest', status.lastIngest?.seriesIngested?.length === 1);

// --- empty-state behaviour --------------------------------------------------------
const cold = { RATES_KV: new MockKV(), ADMIN_TOKEN: 't' };
check('/rates before ingest → 503', (await worker.handleRequest(new Request('https://x/rates'), cold, now)).status === 503);
check('/baserate before ingest → 503', (await worker.handleRequest(new Request('https://x/baserate'), cold, now)).status === 503);
check('unknown path → 404', (await worker.handleRequest(new Request('https://x/nope'), cold, now)).status === 404);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
