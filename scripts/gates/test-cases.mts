import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase } from "./gate-case.mjs";

function lines(...text: readonly string[]): string {
  return `${text.join("\n")}\n`;
}

function amountFunction(name: string, body: readonly string[]): string {
  return lines(
    `/** ${name} */`,
    `export function ${name}(amount: bigint): bigint {`,
    ...body.map((line) => `  ${line}`),
    "}",
    "",
  );
}

// 16 of its 17 lines run under the test below: 94% line coverage, full branch coverage.
const feeSource = [
  lines(
    "/** Takes a fee in basis points, rounding the fee down. */",
    "export function afterFee(amount: bigint, feeBps: bigint): bigint {",
    "  const fee = (amount * feeBps) / 10_000n;",
    "  return amount - fee;",
    "}",
    "",
    "/** Splits an amount into equal parts and a remainder. */",
    "export function split(amount: bigint, parts: bigint): readonly [bigint, bigint] {",
    "  const share = amount / parts;",
    "  const rest = amount - share * parts;",
    "  return [share, rest];",
    "}",
    "",
    "/** Subtracts, never below zero. */",
    "export function subtract(left: bigint, right: bigint): bigint {",
    "  const difference = left - right;",
    "  return difference < 0n ? 0n : difference;",
    "}",
    "",
  ),
  amountFunction("double", ["const twice = amount * 2n;", "return twice;"]),
  amountFunction("triple", ["const thrice = amount * 3n;", "return thrice;"]),
  amountFunction("half", ["const halved = amount / 2n;", "return halved;"]),
  amountFunction("quarter", ["const quartered = amount / 4n;", "return quartered;"]),
  amountFunction("quadruple", ["return amount * 4n;"]),
  amountFunction("untested", ["return amount;"]),
].join("");

const feeTest = lines(
  'import { describe, expect, it } from "vitest";',
  'import { afterFee, double, half, quadruple, quarter, split, subtract, triple } from "./fee.js";',
  "",
  'describe("fee math", () => {',
  '  it("takes a fee and rounds it down", () => {',
  "    expect(afterFee(10_001n, 30n)).toBe(9_971n);",
  "  });",
  "",
  '  it("splits with a remainder", () => {',
  "    expect(split(10n, 3n)).toStrictEqual([3n, 1n]);",
  "  });",
  "",
  '  it("subtracts down to zero", () => {',
  "    expect(subtract(1n, 2n)).toBe(0n);",
  "    expect(subtract(3n, 2n)).toBe(1n);",
  "  });",
  "",
  '  it("scales amounts", () => {',
  "    expect(double(4n)).toBe(8n);",
  "    expect(triple(4n)).toBe(12n);",
  "    expect(half(5n)).toBe(2n);",
  "    expect(quarter(9n)).toBe(2n);",
  "    expect(quadruple(2n)).toBe(8n);",
  "  });",
  "});",
);

// Calls every function but checks nothing, so most mutants survive.
const weakTest = lines(
  'import { describe, expect, it } from "vitest";',
  'import { afterFee, double, half, quadruple, quarter, subtract, triple } from "./fee.js";',
  "",
  'describe("fee math", () => {',
  '  it("runs", () => {',
  "    const results = [afterFee(1n, 1n), subtract(1n, 1n), double(1n), triple(1n)];",
  "    expect([...results, half(1n), quarter(1n), quadruple(1n)]).toHaveLength(7);",
  "  });",
  "});",
);

const offlineTest = lines(
  'import fc from "fast-check";',
  'import { describe, expect, it, vi } from "vitest";',
  'import { ready } from "./index.js";',
  "",
  'describe("the unit test setup", () => {',
  '  it("refuses a real request", async () => {',
  '    await expect(fetch("http://127.0.0.1:8080/")).rejects.toMatchObject({',
  '      cause: { name: "MockNotMatchedError" },',
  "    });",
  "  });",
  "",
  '  it("runs on fake timers", () => {',
  "    expect(vi.isFakeTimers()).toBe(true);",
  "    expect(ready).toBe(1);",
  "  });",
  "",
  '  it("runs fast-check properties", () => {',
  "    fc.assert(fc.property(fc.bigInt(), (value) => value + 0n === value));",
  "  });",
  "});",
);

const moneyThreshold = /\(94\.11%\) does not meet "packages\/engine\/src\/\*\*" threshold \(95%\)/;

// The entry only re-exports, so the package's coverage is the sample's own.
function feePackage(key: string, test: string): Record<string, string> {
  return fixturePackage(key, {
    "index.ts": 'export { afterFee } from "./fee.js";\n',
    "fee.ts": feeSource,
    "fee.test.ts": test,
  });
}

/** Cases for Vitest coverage tiers, the unit test setup and Stryker. */
export function testCases(): readonly GateCase[] {
  return [
    {
      name: "a money-core file at 94% line coverage fails the coverage gate",
      files: feePackage("engine", feeTest),
      steps: [{ command: ["pnpm", "test"], expect: "fail", output: [moneyThreshold] }],
    },
    {
      name: "the same file at 94% passes in a package of the default tier",
      files: feePackage("store", feeTest),
      steps: [{ command: ["pnpm", "test"], expect: "pass", output: [/94\.11/] }],
    },
    {
      name: "unit tests run offline, on fake timers, with fast-check",
      files: fixturePackage("core", { "setup.test.ts": offlineTest }),
      steps: [{ command: ["pnpm", "test"], expect: "pass", output: [/3 passed/] }],
    },
    {
      name: "Stryker reports a mutation score on a sample",
      files: feePackage("engine", feeTest),
      steps: [
        {
          command: ["pnpm", "mutation"],
          expect: "pass",
          output: [/Final mutation score of \d+\.\d+ is greater than or equal to break/],
        },
      ],
    },
    {
      name: "Stryker fails a sample whose tests check nothing",
      files: feePackage("engine", weakTest),
      steps: [
        { command: ["pnpm", "mutation"], expect: "fail", output: [/under breaking threshold 80/] },
      ],
    },
  ];
}
