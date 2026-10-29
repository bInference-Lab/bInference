const runsSchema = /^[1-9]\d{0,3}$/;

/**
 * The crash suite's runs per kill point: `BINFERENCE_CRASH_RUNS`, or one when it is unset. Throws
 * on anything but a count from 1 to 9999.
 */
export function runsPerPoint(text: string | undefined): number {
  if (text === undefined) {
    return 1;
  }
  if (!runsSchema.test(text)) {
    throw new Error(`BINFERENCE_CRASH_RUNS is ${text}; it takes a count from 1 to 9999.`);
  }
  return Number(text);
}
