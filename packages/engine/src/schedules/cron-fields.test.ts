import { describe, expect, it } from "vitest";
import { parseCron } from "./cron-fields.js";

describe("parseCron", () => {
  it("reads lists, ranges and steps in each field", () => {
    expect(parseCron("*/15 9-11 1,15 */6 1-5")).toStrictEqual({
      ok: true,
      value: {
        minutes: [0, 15, 30, 45],
        hours: [9, 10, 11],
        days: [1, 15],
        months: [1, 7],
        weekdays: [1, 2, 3, 4, 5],
        daysRestricted: true,
        weekdaysRestricted: true,
      },
    });
  });

  it("reads month and weekday names in any case, and 7 as sunday", () => {
    expect(parseCron("0 9 * JAN,Mar SAT,sun,7")).toMatchObject({
      ok: true,
      value: { months: [1, 3], weekdays: [0, 6] },
    });
  });

  it("runs a step after a single value to the end of its range", () => {
    expect(parseCron("5/20 0 * * *")).toMatchObject({ ok: true, value: { minutes: [5, 25, 45] } });
  });

  it("counts a field that starts with a star as unrestricted", () => {
    expect(parseCron("0 0 */2 * *")).toMatchObject({
      ok: true,
      value: { daysRestricted: false, weekdaysRestricted: false },
    });
  });

  it.each([
    "0 9 * *",
    "0 0 9 * * *",
    "@daily",
    "60 * * * *",
    "0 24 * * *",
    "0 0 0 * *",
    "0 0 * 13 *",
    "0 0 * * 8",
    "5-1 * * * *",
    "*/0 * * * *",
    "1,,2 * * * *",
    "0 0 * foo *",
    "*/99999999999999999999999 * * * *",
  ])("refuses %s", (text) => {
    expect(parseCron(text)).toStrictEqual({ ok: false, error: "bad_cron" });
  });
});
