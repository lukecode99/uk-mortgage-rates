import type { Env, IngestLog, LatestRate, LatestSnapshot, RatePoint } from './types';
import { parseBoeCsv } from './boe';
import { ALL_SERIES, ATTRIBUTION, BANK_RATE, QUOTED_SERIES, seriesByCode } from './series';
import { MPC_DATES, nextMpcDate } from './mpc';

export { parseBoeCsv, parseBoeDate, buildCsvUrl } from './boe';
export { ALL_SERIES, ATTRIBUTION, BANK_RATE, QUOTED_SERIES, seriesByCode } from './series';
export { MPC_DATES, nextMpcDate } from './mpc';

const LATEST_KEY = 'latest';
const INGEST_LOG_KEY = 'ingest:last';
const histKey = (code: string) => `hist:${code}`;

// Data changes at most twice a month (quoted rates) / on MPC days (Bank Rate);
// an hour of edge caching costs nothing in freshness that matters.
const CACHE_CONTROL = 'public, max-age=3600';

export function buildLatest(
  histories: Record<string, RatePoint[]>,
  fetchedAt: string,
): LatestSnapshot | null {
  const rates: LatestRate[] = [];
  for (const meta of ALL_SERIES) {
    const points = histories[meta.code];
    if (!points?.length) continue;
    const last = points[points.length - 1];
    rates.push({ ...meta, value: last.value, date: last.date });
  }
  if (!rates.length) return null;
  const asOf = rates
    .filter((r) => r.cadence === 'monthly')
    .reduce((max, r) => (r.date > max ? r.date : max), '');
  return { fetchedAt, asOf: asOf || rates[rates.length - 1].date, rates };
}

// Ingest: the GHA runner POSTs the raw IADB CSVs (it can reach the Bank's
// Akamai front; this worker's egress IPs cannot). Histories are replaced
// wholesale — each fetch asks for the full range, so KV never drifts.
export async function ingest(
  env: Env,
  csvs: string[],
  now = new Date(),
): Promise<{ ingested: string[]; missing: string[]; pointCounts: Record<string, number> }> {
  const merged: Record<string, RatePoint[]> = {};
  for (const csv of csvs) {
    for (const [code, points] of Object.entries(parseBoeCsv(csv))) {
      if (points.length) merged[code] = points;
    }
  }

  const expected = ALL_SERIES.map((s) => s.code);
  const ingested = expected.filter((c) => merged[c]?.length);
  const missing = expected.filter((c) => !merged[c]?.length);
  const pointCounts = Object.fromEntries(ingested.map((c) => [c, merged[c].length]));
  if (!ingested.length) return { ingested, missing, pointCounts };

  const nowIso = now.toISOString();
  await Promise.all(ingested.map((c) => env.RATES_KV.put(histKey(c), JSON.stringify(merged[c]))));

  // Refresh `latest` from KV, not just this payload, so a partial ingest
  // (say, Bank Rate only) never wipes the quoted-rate values.
  const histories: Record<string, RatePoint[]> = {};
  await Promise.all(
    expected.map(async (c) => {
      histories[c] = merged[c] ?? (await env.RATES_KV.get<RatePoint[]>(histKey(c), 'json')) ?? [];
    }),
  );
  const latest = buildLatest(histories, nowIso);
  if (latest) await env.RATES_KV.put(LATEST_KEY, JSON.stringify(latest));

  const log: IngestLog = { at: nowIso, seriesIngested: ingested, pointCounts };
  await env.RATES_KV.put(INGEST_LOG_KEY, JSON.stringify(log));
  return { ingested, missing, pointCounts };
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': CACHE_CONTROL, ...CORS_HEADERS },
  });
}

const authorized = (req: Request, env: Env): boolean =>
  Boolean(env.ADMIN_TOKEN) && req.headers.get('authorization') === `Bearer ${env.ADMIN_TOKEN}`;

export async function handleRequest(req: Request, env: Env, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method === 'POST' && url.pathname === '/admin/ingest') {
    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);
    const body = (await req.json().catch(() => null)) as { csvs?: unknown } | null;
    const csvs = Array.isArray(body?.csvs) ? body.csvs.filter((c): c is string => typeof c === 'string') : [];
    if (!csvs.length) return json({ error: 'body must be { csvs: [<IADB CSV>, ...] }' }, 400);
    const result = await ingest(env, csvs, now);
    if (!result.ingested.length) return json({ error: 'no expected series found in payload', ...result }, 422);
    return json({ ok: true, ...result });
  }
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  if (url.pathname === '/') {
    return json({
      service: 'uk-mortgage-rates',
      description: 'Bank of England benchmark mortgage rates for the Remortgage Countdown app',
      endpoints: ['/rates', '/rates/history?series=<code>', '/baserate', 'POST /admin/ingest (bearer)'],
      series: ALL_SERIES,
      attribution: ATTRIBUTION,
    });
  }

  if (url.pathname === '/rates') {
    const latest = await env.RATES_KV.get<LatestSnapshot>(LATEST_KEY, 'json');
    if (!latest) return json({ error: 'no data ingested yet' }, 503);
    return json({ ...latest, attribution: ATTRIBUTION });
  }

  if (url.pathname === '/rates/history') {
    const raw = url.searchParams.get('series');
    if (!raw) return json({ error: 'series required, e.g. /rates/history?series=IUMBV34' }, 400);
    const meta = seriesByCode(raw);
    if (!meta) return json({ error: `unknown series "${raw}"`, known: ALL_SERIES.map((s) => s.code) }, 400);
    const points = await env.RATES_KV.get<RatePoint[]>(histKey(meta.code), 'json');
    if (!points?.length) return json({ error: 'no data ingested yet' }, 503);
    return json({ ...meta, points, attribution: ATTRIBUTION });
  }

  if (url.pathname === '/baserate') {
    const points = await env.RATES_KV.get<RatePoint[]>(histKey(BANK_RATE.code), 'json');
    if (!points?.length) return json({ error: 'no data ingested yet' }, 503);
    const last = points[points.length - 1];
    // effectiveDate = first day the current rate value applied.
    let effectiveIdx = points.length - 1;
    while (effectiveIdx > 0 && points[effectiveIdx - 1].value === last.value) effectiveIdx--;
    const todayIso = now.toISOString().slice(0, 10);
    return json({
      ...BANK_RATE,
      rate: last.value,
      asOf: last.date,
      effectiveDate: points[effectiveIdx].date,
      nextMpcDate: nextMpcDate(todayIso),
      mpcDates: MPC_DATES,
      attribution: ATTRIBUTION,
    });
  }

  if (url.pathname === '/status') {
    const log = await env.RATES_KV.get<IngestLog>(INGEST_LOG_KEY, 'json');
    const latest = await env.RATES_KV.get<LatestSnapshot>(LATEST_KEY, 'json');
    return json({
      lastIngest: log ?? null,
      asOf: latest?.asOf ?? null,
      seriesServed: latest?.rates.length ?? 0,
      attribution: ATTRIBUTION,
    });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handleRequest(req, env),
};
