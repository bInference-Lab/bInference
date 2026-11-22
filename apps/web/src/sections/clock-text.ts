/** The time of day at progress `p` through it, on a 24-hour clock: 0 is 00:00, 1 is 23:59. */
export function clockText(p: number): string {
  const minutes = Math.min(1439, Math.round(Math.min(1, Math.max(0, p)) * 1439));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
