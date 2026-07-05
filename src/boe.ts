import type { RatePoint } from './types';

// Parser for the IADB CSV export (fromshowcolumns.asp with CSVF=TN&UsingCodes=Y):
// a header row of DATE followed by one column per series code, then one row per
// observation with dates like "31 Jan 2026". Missing observations are blank or
// "..". The worker never fetches this itself — IADB's Akamai front rejects
// datacentre IPs — a scheduled GitHub Actions runner fetches the CSV and POSTs
// it to /admin/ingest (see .github/workflows/ingest.yml).

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "31 Jan 2026" → "2026-01-31" (also accepts already-ISO dates).
export function parseBoeDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const splitCsvLine = (line: string): string[] =>
  line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));

// Returns one ascending-dated series per code found in the header. Codes we
// did not ask for are still returned — the caller decides what to keep.
export function parseBoeCsv(csv: string): Record<string, RatePoint[]> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return {};

  const header = splitCsvLine(lines[0]);
  if (header[0].toUpperCase() !== 'DATE') return {};
  const codes = header.slice(1).map((c) => c.toUpperCase());

  const out: Record<string, RatePoint[]> = {};
  for (const code of codes) out[code] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const date = parseBoeDate(cells[0] ?? '');
    if (!date) continue;
    codes.forEach((code, i) => {
      const value = Number(cells[i + 1]);
      if (cells[i + 1] !== '' && Number.isFinite(value)) out[code].push({ date, value });
    });
  }

  for (const code of codes) out[code].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// URL the GitHub Actions ingest job fetches; kept here so tests pin the exact
// query contract (max 300 series per request — we use 11).
export function buildCsvUrl(codes: string[], fromDdMonYyyy: string, toDdMonYyyy: string): string {
  const p = new URLSearchParams({
    'csv.x': 'yes',
    Datefrom: fromDdMonYyyy,
    Dateto: toDdMonYyyy,
    SeriesCodes: codes.join(','),
    CSVF: 'TN',
    UsingCodes: 'Y',
  });
  return `https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?${p.toString()}`;
}
