// MPC announcement dates (static, update yearly when the Bank publishes the
// next year's schedule — usually each autumn). ISO dates, announcement day.
export const MPC_DATES: string[] = [
  '2026-02-05',
  '2026-03-19',
  '2026-05-07',
  '2026-06-18',
  '2026-08-06',
  '2026-09-17',
  '2026-11-05',
  '2026-12-17',
];

export const nextMpcDate = (todayIso: string): string | null =>
  MPC_DATES.find((d) => d >= todayIso) ?? null;
