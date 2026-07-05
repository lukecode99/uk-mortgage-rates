# uk-mortgage-rates

Cloudflare worker serving Bank of England benchmark mortgage rates — the data
layer for the Remortgage Countdown app.

## Data

Monthly **quoted household rates** (average advertised rates) and the daily
**Official Bank Rate**, from the Bank of England's Interactive Database (IADB):

| Code | Series |
|------|--------|
| IUMZICQ | 2yr fixed, 60% LTV |
| IUMBV34 | 2yr fixed, 75% LTV |
| IUMZICR | 2yr fixed, 85% LTV |
| IUMB482 | 2yr fixed, 90% LTV |
| IUM2WTL | 2yr fixed, 95% LTV |
| IUMBV37 | 3yr fixed, 75% LTV |
| IUMBV42 | 5yr fixed, 75% LTV |
| IUMBV45 | 10yr fixed, 75% LTV |
| IUMBV24 | Lifetime tracker |
| IUMTLMV | Revert-to-rate (ex-SVR) |
| IUDBEDR | Official Bank Rate (daily) |

> Contains public sector information licensed under the
> [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
> Source: Bank of England Database (IADB). Every API response carries this
> attribution.

## API

- `GET /rates` — latest value for every series, plus `asOf` (newest monthly observation)
- `GET /rates/history?series=IUMBV34` — full monthly/daily history for one series
- `GET /baserate` — current Bank Rate, its effective date, and the MPC announcement calendar
- `GET /status` — last ingest log
- `POST /admin/ingest` — bearer-auth endpoint the scheduled ingest job pushes raw IADB CSVs to

## Architecture

The IADB endpoint sits behind Akamai and rejects datacentre IPs, so the worker
never fetches it. A scheduled GitHub Actions job (`.github/workflows/ingest.yml`)
fetches the CSVs with a browser User-Agent and POSTs them to `/admin/ingest`;
the worker parses (`src/boe.ts`) and stores full per-series histories in KV.
Each fetch covers the full range (2016→today) and replaces the stored history,
so KV can never drift. MPC announcement dates are static (`src/mpc.ts`) and
updated yearly.

## Development

```
npm install
npm test          # bundles the worker, runs API tests against an in-memory KV
npm run typecheck
node scripts/check-live.mjs   # integration checks against the deployed worker
```

Deploy: set the KV namespace id in `wrangler.toml`, `wrangler secret put
ADMIN_TOKEN`, then `wrangler deploy`. The GitHub repo needs an `ADMIN_TOKEN`
actions secret matching the worker's.
