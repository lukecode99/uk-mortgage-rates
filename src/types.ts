export interface Env {
  RATES_KV: KVNamespace;
  // Set with `wrangler secret put ADMIN_TOKEN` — gates POST /admin/ingest.
  ADMIN_TOKEN: string;
}

export interface RatePoint {
  date: string; // ISO yyyy-mm-dd (month-end for monthly series)
  value: number; // per cent
}

export interface SeriesMeta {
  code: string;
  label: string;
  cadence: 'monthly' | 'daily';
}

export interface LatestRate extends SeriesMeta {
  value: number;
  date: string;
}

export interface LatestSnapshot {
  fetchedAt: string; // when the ingest run delivered the data
  asOf: string; // newest observation date across the quoted-rate series
  rates: LatestRate[];
}

export interface IngestLog {
  at: string;
  seriesIngested: string[];
  pointCounts: Record<string, number>;
}
