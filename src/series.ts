import type { SeriesMeta } from './types';

// Bank of England IADB "quoted household interest rates" — monthly averages of
// advertised rates, published on the 5th and 21st working day of each month.
// Codes hand-checked against the IADB Quoted Rates table (see README).
export const QUOTED_SERIES: SeriesMeta[] = [
  { code: 'IUMZICQ', label: '2yr fixed, 60% LTV', cadence: 'monthly' },
  { code: 'IUMBV34', label: '2yr fixed, 75% LTV', cadence: 'monthly' },
  { code: 'IUMZICR', label: '2yr fixed, 85% LTV', cadence: 'monthly' },
  { code: 'IUMB482', label: '2yr fixed, 90% LTV', cadence: 'monthly' },
  { code: 'IUM2WTL', label: '2yr fixed, 95% LTV', cadence: 'monthly' },
  { code: 'IUMBV37', label: '3yr fixed, 75% LTV', cadence: 'monthly' },
  { code: 'IUMBV42', label: '5yr fixed, 75% LTV', cadence: 'monthly' },
  { code: 'IUMBV45', label: '10yr fixed, 75% LTV', cadence: 'monthly' },
  { code: 'IUMBV24', label: 'Lifetime tracker', cadence: 'monthly' },
  // The old "SVR" series was discontinued; IUMTLMV is its replacement —
  // "revert-to-rate": the average rate a mortgage rolls onto after a deal ends.
  { code: 'IUMTLMV', label: 'Revert-to-rate (ex-SVR)', cadence: 'monthly' },
];

export const BANK_RATE: SeriesMeta = {
  code: 'IUDBEDR',
  label: 'Official Bank Rate',
  cadence: 'daily',
};

export const ALL_SERIES: SeriesMeta[] = [...QUOTED_SERIES, BANK_RATE];

export const seriesByCode = (code: string): SeriesMeta | undefined =>
  ALL_SERIES.find((s) => s.code === code.toUpperCase());

// OGL v3 requires this to accompany every reuse of the data.
export const ATTRIBUTION =
  'Contains public sector information licensed under the Open Government Licence v3.0. ' +
  'Source: Bank of England Database (IADB), bankofengland.co.uk/boeapps/database.';
