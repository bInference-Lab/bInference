import { err, ok, type Result } from "@binference/core";
import { z } from "zod";

/**
 * A five-field cron expression, parsed: the minutes, hours, days of the month, months and days of
 * the week it allows, each sorted. A day matches by the month day or the weekday when both fields
 * are restricted, else by the one that is (decision 0231).
 */
export interface CronFields {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly days: readonly number[];
  /** 1 for January to 12 for December. */
  readonly months: readonly number[];
  /** 0 for Sunday to 6 for Saturday. */
  readonly weekdays: readonly number[];
  /** Whether the month day field names days, rather than starting with `*`. */
  readonly daysRestricted: boolean;
  /** Whether the weekday field names days, rather than starting with `*`. */
  readonly weekdaysRestricted: boolean;
}

interface FieldRange {
  readonly min: number;
  readonly max: number;
  readonly names?: readonly string[];
}

const minuteRange: FieldRange = { min: 0, max: 59 };
const hourRange: FieldRange = { min: 0, max: 23 };
const dayRange: FieldRange = { min: 1, max: 31 };
const monthNames = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const monthRange: FieldRange = { min: 1, max: 12, names: monthNames };
// 7 is Sunday too, as most cron dialects read it.
const weekdayRange: FieldRange = {
  min: 0,
  max: 7,
  names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
};

const partPattern = /^(\*|[0-9a-z]+(?:-[0-9a-z]+)?)(?:\/([0-9]+))?$/;
const digitsSchema = z.coerce.number<string>().pipe(z.int().nonnegative());

// A number in the field's range, or a name the field knows, such as `mon` or `jan`.
function valueOf(text: string, range: FieldRange): number | undefined {
  const named = range.names?.indexOf(text) ?? -1;
  if (named >= 0) {
    return range.min + named;
  }
  const value = /^[0-9]{1,2}$/.test(text) ? digitsSchema.parse(text) : undefined;
  return value !== undefined && value >= range.min && value <= range.max ? value : undefined;
}

function boundsOf(text: string, range: FieldRange): readonly [number, number] | undefined {
  if (text === "*") {
    return [range.min, range.max];
  }
  const [first = "", last] = text.split("-");
  const from = valueOf(first, range);
  const to = last === undefined ? from : valueOf(last, range);
  return from === undefined || to === undefined || from > to ? undefined : [from, to];
}

function stepOf(text: string | undefined, range: FieldRange): number | undefined {
  const step = text === undefined ? 1 : digitsSchema.safeParse(text).data;
  return step !== undefined && step >= 1 && step <= range.max ? step : undefined;
}

function valuesFrom(from: number, to: number, step: number): readonly number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value += step) {
    values.push(value);
  }
  return values;
}

// One part of a list: `*`, `5`, `1-5`, `*/15` or `1-30/2`. A step after a single value runs to the
// end of the range, so `5/15` is 5, 20, 35 and 50.
function partValues(part: string, range: FieldRange): readonly number[] | undefined {
  const [, span = "", stepText] = partPattern.exec(part) ?? [];
  const bounds = boundsOf(span, range);
  const step = stepOf(stepText, range);
  if (bounds === undefined || step === undefined) {
    return undefined;
  }
  const isSingle = stepText !== undefined && span !== "*" && !span.includes("-");
  return valuesFrom(bounds[0], isSingle ? range.max : bounds[1], step);
}

function fieldValues(text: string, range: FieldRange): readonly number[] | undefined {
  const parts = text.split(",").map((part) => partValues(part, range));
  if (parts.some((values) => values === undefined)) {
    return undefined;
  }
  const values = new Set(parts.flatMap((each) => each ?? []));
  return [...values].toSorted((left, right) => left - right);
}

const ranges = [minuteRange, hourRange, dayRange, monthRange, weekdayRange];

function isEveryFieldRead(
  values: readonly (readonly number[] | undefined)[],
): values is readonly (readonly number[])[] {
  return values.every((each) => each !== undefined);
}

/**
 * Parses a five-field cron expression, `minute hour day month weekday`, in numbers or three-letter
 * English names (`mon`, `jan`), with `*`, lists, ranges and steps, case-insensitive. Anything else,
 * such as a sixth field or `@daily`, is `bad_cron`.
 */
export function parseCron(text: string): Result<CronFields, "bad_cron"> {
  const fields = text.trim().toLowerCase().split(/\s+/);
  const values = ranges.map((range, index) => fieldValues(fields[index] ?? "", range));
  if (fields.length !== ranges.length || !isEveryFieldRead(values)) {
    return err("bad_cron");
  }
  const [minutes = [], hours = [], days = [], months = [], weekdayValues = []] = values;
  const weekdays = [...new Set(weekdayValues.map((value) => value % 7))].toSorted((a, b) => a - b);
  const [, , day = "", , weekday = ""] = fields;
  return ok({
    minutes,
    hours,
    days,
    months,
    weekdays,
    daysRestricted: !day.startsWith("*"),
    weekdaysRestricted: !weekday.startsWith("*"),
  });
}
