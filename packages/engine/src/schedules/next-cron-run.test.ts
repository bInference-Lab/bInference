import { describe, expect, it } from "vitest";
import { type CronFields, parseCron } from "./cron-fields.js";
import { nextCronRun } from "./next-cron-run.js";

const newYork = "America/New_York";

function cron(text: string): CronFields {
  const parsed = parseCron(text);
  if (!parsed.ok) {
    throw new Error(`${text} is not a cron expression.`);
  }
  return parsed.value;
}

function next(text: string, after: string, timeZone: string): string | undefined {
  const run = nextCronRun(cron(text), Date.parse(after), timeZone);
  return run === undefined ? undefined : new Date(run).toISOString();
}

describe("nextCronRun", () => {
  it("runs at the wall time of the zone it is given", () => {
    expect([
      next("0 9 * * *", "2027-01-04T00:00:00Z", "Asia/Shanghai"),
      next("0 9 * * *", "2027-01-04T01:00:00Z", "Asia/Shanghai"),
      next("0 9 * * *", "2027-01-04T00:00:00Z", newYork),
    ]).toStrictEqual([
      "2027-01-04T01:00:00.000Z",
      "2027-01-05T01:00:00.000Z",
      "2027-01-04T14:00:00.000Z",
    ]);
  });

  it("keeps the wall time across a change of the clocks", () => {
    expect([
      next("0 9 * * *", "2027-03-13T15:00:00Z", newYork),
      next("0 9 * * *", "2027-11-06T14:00:00Z", newYork),
    ]).toStrictEqual(["2027-03-14T13:00:00.000Z", "2027-11-07T14:00:00.000Z"]);
  });

  it("runs a wall time the clocks skip when they jump past it", () => {
    expect([
      next("30 2 * * *", "2027-03-14T05:00:00Z", newYork),
      next("30 2 * * *", "2027-03-14T07:00:00Z", newYork),
    ]).toStrictEqual(["2027-03-14T07:00:00.000Z", "2027-03-15T06:30:00.000Z"]);
  });

  it("runs every skipped wall time of a date once, at the jump", () => {
    expect([
      next("*/20 2 * * *", "2027-03-14T06:59:00Z", newYork),
      next("*/20 2-3 * * *", "2027-03-14T07:00:00Z", newYork),
    ]).toStrictEqual(["2027-03-14T07:00:00.000Z", "2027-03-14T07:20:00.000Z"]);
  });

  it("runs a wall time the clocks show twice once, at its first occurrence", () => {
    expect([
      next("30 1 * * *", "2027-11-07T04:00:00Z", newYork),
      next("30 1 * * *", "2027-11-07T05:30:00Z", newYork),
      next("*/30 * * * *", "2027-11-07T05:30:00Z", newYork),
    ]).toStrictEqual([
      "2027-11-07T05:30:00.000Z",
      "2027-11-08T06:30:00.000Z",
      "2027-11-07T07:00:00.000Z",
    ]);
  });

  it("matches either the month day or the weekday when both are restricted", () => {
    expect([
      next("0 0 13 * 5", "2027-01-01T00:00:00Z", "UTC"),
      next("0 0 */2 * 5", "2027-01-01T00:00:00Z", "UTC"),
    ]).toStrictEqual(["2027-01-08T00:00:00.000Z", "2027-01-15T00:00:00.000Z"]);
  });

  it("finds a leap day years away, and never a day that does not exist", () => {
    expect([
      next("0 0 29 2 *", "2096-03-01T00:00:00Z", "UTC"),
      next("0 0 31 2 *", "2027-01-01T00:00:00Z", "UTC"),
    ]).toStrictEqual(["2104-02-29T00:00:00.000Z", undefined]);
  });

  it("throws for a zone intl does not know", () => {
    expect(() => nextCronRun(cron("0 9 * * *"), 0, "Mars/Olympus")).toThrow(
      expect.objectContaining({ code: "i18n.bad_time_zone" }),
    );
  });
});
