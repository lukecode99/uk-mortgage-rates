// Integration check against the deployed worker — run after deploy/ingest:
//   node scripts/check-live.mjs [worker-base-url]
// Verifies every series is served with sane values, attribution is present,
// and the history/baserate endpoints agree with /rates.
const WORKER = process.argv[2] ?? 'https://uk-mortgage-rates.nanoluke521.workers.dev';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

const rates = await (await fetch(`${WORKER}/rates`)).json();
check('/rates serves 11 series', rates.rates?.length === 11, `got ${rates.rates?.length}`);
check('asOf is a recent month', /^\d{4}-\d{2}-\d{2}$/.test(rates.asOf ?? ''), rates.asOf);
check('attribution present', /Open Government Licence/.test(rates.attribution ?? ''));
for (const r of rates.rates ?? []) {
  check(`${r.code} (${r.label}) value sane`, r.value > 0 && r.value < 15, `${r.value}% @ ${r.date}`);
}

const hist = await (await fetch(`${WORKER}/rates/history?series=IUMBV34`)).json();
check('history has years of monthly points', (hist.points?.length ?? 0) > 60, `${hist.points?.length} points`);
const histLast = hist.points?.[hist.points.length - 1];
const ratesBV34 = rates.rates?.find((r) => r.code === 'IUMBV34');
check(
  'history tail matches /rates latest',
  histLast?.date === ratesBV34?.date && histLast?.value === ratesBV34?.value,
);

const base = await (await fetch(`${WORKER}/baserate`)).json();
check('baserate sane', base.rate > 0 && base.rate < 10, `${base.rate}% effective ${base.effectiveDate}`);
check('baserate matches /rates IUDBEDR', base.rate === rates.rates?.find((r) => r.code === 'IUDBEDR')?.value);
check('next MPC date is in the future', (base.nextMpcDate ?? '') >= new Date().toISOString().slice(0, 10), base.nextMpcDate);

const status = await (await fetch(`${WORKER}/status`)).json();
check('a fresh ingest is logged', Boolean(status.lastIngest?.at), status.lastIngest?.at);

console.log(failures ? `\n${failures} FAILURES` : '\nall live checks passed');
process.exit(failures ? 1 : 0);
