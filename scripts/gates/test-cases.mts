import { graphPath, loadGraph } from "../package-graph/graph.mjs";
import { fixturePackage, sampleKey } from "./fixture-package.mjs";
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

// The rules Stryker mutates. Every mutant reruns the tests, so the sample stays this small.
const feeRules = lines(
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
);

// 16 of its 17 lines run under the test below: 94% line coverage, full branch coverage.
const feeSource = [
  feeRules,
  amountFunction("double", ["const twice = amount * 2n;", "return twice;"]),
  amountFunction("triple", ["const thrice = amount * 3n;", "return thrice;"]),
  amountFunction("half", ["const halved = amount / 2n;", "return halved;"]),
  amountFunction("quarter", ["const quartered = amount / 4n;", "return quartered;"]),
  amountFunction("quadruple", ["return amount * 4n;"]),
  amountFunction("untested", ["return amount;"]),
].join("");

const ruleChecks = [
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
];

function feeTestOf(names: string, checks: readonly string[]): string {
  return lines(
    'import { describe, expect, it } from "vitest";',
    `import { ${names} } from "./fee.js";`,
    "",
    'describe("fee math", () => {',
    ...checks,
    "});",
  );
}

const feeTest = feeTestOf("afterFee, double, half, quadruple, quarter, split, subtract, triple", [
  ...ruleChecks,
  "",
  '  it("scales amounts", () => {',
  "    expect(double(4n)).toBe(8n);",
  "    expect(triple(4n)).toBe(12n);",
  "    expect(half(5n)).toBe(2n);",
  "    expect(quarter(9n)).toBe(2n);",
  "    expect(quadruple(2n)).toBe(8n);",
  "  });",
]);

const ruleTest = feeTestOf("afterFee, split, subtract", ruleChecks);

// Calls every rule but checks nothing, so most mutants survive.
const weakTest = feeTestOf("afterFee, split, subtract", [
  '  it("runs", () => {',
  "    expect([afterFee(1n, 1n), split(1n, 1n), subtract(1n, 1n)]).toHaveLength(3);",
  "  });",
]);

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

const moneyThreshold = /\(94\.11%\) does not meet "packages\/sample\/src\/\*\*" threshold \(95%\)/;

// The entry only re-exports, so the package's coverage is the sample's own.
function feePackage(test: string, source = feeSource): Record<string, string> {
  return fixturePackage(sampleKey, {
    "index.ts": 'export { afterFee } from "./fee.js";\n',
    "fee.ts": source,
    "fee.test.ts": test,
  });
}

// The graph with the sample as the only money-core package Stryker mutates, so a case measures
// the sample alone, whatever real packages exist.
function moneyGraph(repo: string): Record<string, string> {
  const graph = loadGraph(repo);
  const packages = Object.fromEntries(
    Object.entries(graph.packages).map(([key, row]) => [key, { ...row, mutation: false }]),
  );
  const sample = { imports: [], money: true, coverage: 95, mutation: true };
  const planted = { ...graph, packages: { ...packages, [sampleKey]: sample } };
  return { [graphPath]: `${JSON.stringify(planted, null, 2)}\n` };
}

function moneySample(repo: string, test: string, source = feeSource): Record<string, string> {
  return { ...feePackage(test, source), ...moneyGraph(repo) };
}

// The cases run only the planted sample, so their cost does not grow with the repository.
const sampleTest: readonly string[] = [
  "pnpm",
  "test",
  "--project",
  `packages/${sampleKey}`,
  `--coverage.include=packages/${sampleKey}/src/**`,
];
const sampleOnly: Readonly<Record<string, string>> = { MUTATE_PACKAGES: sampleKey };

function coverageCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a money-core file at 94% line coverage fails the coverage gate",
      cost: 3,
      files: moneySample(repo, feeTest),
      steps: [{ command: sampleTest, expect: "fail", output: [moneyThreshold] }],
    },
    {
      name: "the same file at 94% passes in a package of the default tier",
      cost: 3,
      files: feePackage(feeTest),
      steps: [{ command: sampleTest, expect: "pass", output: [/94\.11/] }],
    },
    {
      name: "unit tests run offline, on fake timers, with fast-check",
      cost: 2,
      files: fixturePackage(sampleKey, { "setup.test.ts": offlineTest }),
      steps: [
        {
          command: [...sampleTest, "--reporter=verbose"],
          expect: "pass",
          output: [/✓ .*refuses a real request/, /✓ .*runs on fake timers/, /✓ .*runs fast-check/],
        },
      ],
    },
  ];
}

function mutationCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "Stryker reports a mutation score on a sample",
      cost: 3,
      files: moneySample(repo, ruleTest, feeRules),
      steps: [
        {
          command: ["pnpm", "mutation"],
          env: sampleOnly,
          expect: "pass",
          output: [/Final mutation score of \d+\.\d+ is greater than or equal to break/],
        },
      ],
    },
    {
      name: "Stryker fails a sample whose tests check nothing",
      cost: 3,
      files: moneySample(repo, weakTest, feeRules),
      steps: [
        {
          command: ["pnpm", "mutation"],
          env: sampleOnly,
          expect: "fail",
          output: [/under breaking threshold 80/],
        },
      ],
    },
  ];
}

/** Cases for Vitest coverage tiers, the unit test setup and Stryker. */
export function testCases(repo: string): readonly GateCase[] {
  return [...coverageCases(repo), ...mutationCases(repo)];
}
