// MPC announcement dates (static, update yearly when the Bank publishes the
// next year's schedule — usually each autumn). ISO dates, announcement day.
// 2026 list per bankofengland.co.uk/monetary-policy/upcoming-mpc-dates
// (all Thursdays, decisions at 12:00 UK time).
export const MPC_DATES: string[] = [
  '2026-02-05',
  '2026-03-19',
  '2026-04-30',
  '2026-06-18',
  '2026-07-30',
  '2026-09-17',
  '2026-11-05',
  '2026-12-17',
];

export const nextMpcDate = (todayIso: string): string | null =>
  MPC_DATES.find((d) => d >= todayIso) ?? null;
