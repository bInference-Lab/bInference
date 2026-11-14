import type { JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseArgumentsJson } from "../tools/arguments-json.schema.js";
import { repairCall, type RepairTools } from "./repair-call.js";

// Decision 0447 over generated calls: a repair reads the form a model meant and nothing else. A
// form repair never yields a value the undamaged call did not hold, and no repair changes a
// string's content or turns a number into a string, or back, where the schema asks for a string.

type Damage = "single_quotes" | "trailing_comma" | "closed" | "words_around" | "string" | "fence";

// One escape of a JSON string's body as a single-quoted string writes it: an apostrophe escaped,
// a double quote bare, every other escape as it was.
function singleQuotedEscape(all: string, next: string | undefined): string {
  if (next === undefined) {
    return "\\'";
  }
  return next === '"' ? '"' : all;
}

// Each string token of JSON text written in single quotes, its characters unchanged.
function singleQuoted(text: string): string {
  return text.replace(/"((?:[^"\\]|\\.)*)"/gu, (_token, body: string) => {
    const written = body.replace(/\\(.)|'/gu, (all: string, next?: string) =>
      singleQuotedEscape(all, next),
    );
    return `'${written}'`;
  });
}

const damages: Readonly<Record<Damage, (text: string) => string>> = {
  single_quotes: singleQuoted,
  trailing_comma: (text) => `${text.slice(0, -1)},}`,
  closed: (text) => text.slice(0, -1),
  words_around: (text) => `Arguments: ${text}`,
  string: (text) => JSON.stringify(text),
  fence: (text) => `\`\`\`json\n${text}\n\`\`\``,
};

// Inner damage first, as a model's text wraps it: the repair takes the wrapping off first.
const order: readonly Damage[] = [
  "single_quotes",
  "trailing_comma",
  "closed",
  "words_around",
  "string",
  "fence",
];

function damaged(text: string, chosen: ReadonlySet<Damage>): string {
  return order.filter((damage) => chosen.has(damage)).reduce((so, d) => damages[d](so), text);
}

const leaf = fc.oneof(
  fc.string({ unit: "binary", maxLength: 12 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
  fc.boolean(),
  fc.constant(null),
);
const { tree } = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leaf,
    fc.array(tie("tree"), { maxLength: 3 }),
    fc.dictionary(fc.string({ maxLength: 6 }), tie("tree"), { maxKeys: 3 }),
  ),
}));
const argumentsObject = fc.dictionary(fc.string({ maxLength: 8 }), tree, { maxKeys: 4 });
const damageSet = fc
  .subarray([...order], { minLength: 1 })
  .map((chosen) => new Set<Damage>(chosen));

function readingOf(text: string): JsonValue | undefined {
  const read = parseArgumentsJson(text);
  return read.ok ? read.value : undefined;
}

const anyObject: RepairTools = {
  declarations: [{ name: "probe", description: "probe", parameters: { type: "object" } }],
  kindOf: () => "propose",
};

/** What the tool box reads of a damaged call once repaired, and of the call before the damage. */
interface Readings {
  readonly isRepaired: boolean;
  /** `undefined` for a repair the parser refuses. */
  readonly repaired: JsonValue | undefined;
  readonly undamaged: JsonValue | undefined;
}

function readingsOf(args: object, chosen: ReadonlySet<Damage>): Readings {
  const written = JSON.stringify(args);
  const call = { id: "c", name: "probe", argumentsText: damaged(written, chosen) };
  const repaired = repairCall(call, anyObject);
  return {
    isRepaired: repaired !== undefined,
    repaired: readingOf(repaired?.argumentsText ?? ""),
    undamaged: readingOf(written),
  };
}

// What the repair read, or, with no repair, what the undamaged call held.
function readOrUndamaged(readings: Readings): JsonValue | undefined {
  return readings.isRepaired ? readings.repaired : readings.undamaged;
}

// A cut, or a JSON string around words, may leave nothing the repair can read without a guess.
function isSureToRepair(chosen: ReadonlySet<Damage>): boolean {
  return !chosen.has("closed") && !(chosen.has("string") && chosen.has("words_around"));
}

describe("a form repair", () => {
  it("never yields a value the undamaged call did not hold", () => {
    fc.assert(
      fc.property(argumentsObject, damageSet, (args, chosen) => {
        const readings = readingsOf(args, chosen);
        expect(readOrUndamaged(readings)).toStrictEqual(readings.undamaged);
      }),
    );
  });

  it("repairs every damage short of a cut", () => {
    fc.assert(
      fc.property(argumentsObject, damageSet.filter(isSureToRepair), (args, chosen) => {
        const readings = readingsOf(args, chosen);
        expect(readings.repaired).toStrictEqual(readings.undamaged);
      }),
    );
  });
});

// The probe read's schema: strings, a decimal string of base units, integers, in objects and
// lists, none required.
const fields: RepairTools = {
  declarations: [
    {
      name: "probe_read",
      description: "probe",
      parameters: {
        type: "object",
        properties: {
          s: { type: "string" },
          base: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
          n: { type: "integer" },
          o: { type: "object", properties: { t: { type: "string" }, m: { type: "integer" } } },
          l: { type: "array", items: { type: "object", properties: { u: { type: "string" } } } },
        },
      },
    },
  ],
  kindOf: () => "read",
};

const writtenValue = fc.oneof(
  fc.string({ unit: "binary", maxLength: 10 }),
  fc.stringMatching(/^(?:0|[1-9]\d{0,20})$/u),
  fc.integer(),
  fc.bigInt({ min: 2n ** 53n, max: 2n ** 70n }).map((big) => ({ big: big.toString() })),
  fc.constant(null),
);
const fieldsObject = fc.record(
  {
    s: writtenValue,
    base: writtenValue,
    n: writtenValue,
    o: fc.record({ t: writtenValue, m: writtenValue }, { requiredKeys: [] }),
    l: fc.array(fc.record({ u: writtenValue }, { requiredKeys: [] }), { maxLength: 2 }),
  },
  { requiredKeys: [] },
);

// JSON text with each `{ big }` leaf written as a plain integer past 2^53.
function asJson(value: object): string {
  return JSON.stringify(value).replace(/\{"big":"(\d+)"\}/gu, "$1");
}

/** A value as written, each number kept as its text, so a string never equals a number. */
type Exact = string | boolean | null | { readonly number: string } | readonly Exact[] | ExactObject;
interface ExactObject {
  readonly [key: string]: Exact;
}

function keepNumberText(
  key: string,
  item: Exact | number,
  source?: { readonly source?: string },
): Exact {
  return typeof item === "number" ? { number: source?.source ?? String(item) } : item;
}

function exactly(text: string): ExactObject {
  return JSON.parse(text, keepNumberText) as ExactObject;
}

function fieldOf(value: Exact | undefined, key: string): Exact | undefined {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject && !("number" in value) ? (value as ExactObject)[key] : undefined;
}

// The string-typed fields' values, as written, in the order the schema names them.
function stringFieldsOf(object: ExactObject): readonly (Exact | undefined)[] {
  const list = object["l"];
  const rows = Array.isArray(list) ? (list as readonly Exact[]) : [];
  return [
    object["s"],
    object["base"],
    fieldOf(object["o"], "t"),
    ...rows.map((row) => fieldOf(row, "u")),
  ];
}

/** The string-typed fields before and after a repair; `null` stands for one left out as null. */
interface StringFields {
  readonly before: readonly (Exact | undefined)[];
  readonly after: readonly (Exact | undefined)[];
}

function stringFields(args: object, chosen: ReadonlySet<Damage>): StringFields {
  const text = asJson(args);
  const call = { id: "c", name: "probe_read", argumentsText: damaged(text, chosen) };
  const repaired = repairCall(call, fields);
  const before = stringFieldsOf(exactly(text));
  const read = repaired === undefined ? before : stringFieldsOf(exactly(repaired.argumentsText));
  const after = read.map((item, at) => (item === undefined && before[at] === null ? null : item));
  return { before, after };
}

describe("every repair", () => {
  it("keeps each string-typed field as written, a null left out at most", () => {
    fc.assert(
      fc.property(fieldsObject, damageSet, (args, chosen) => {
        const { before, after } = stringFields(args, chosen);
        expect(after).toStrictEqual(before);
      }),
    );
  });
});
