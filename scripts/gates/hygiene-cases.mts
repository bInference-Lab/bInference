import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixturePackage, sampleKey } from "./fixture-package.mjs";
import { failingCase, type GateCase } from "./gate-case.mjs";

// Directives are assembled here, so this file holds none itself.
const disable = ["oxlint", "disable"].join("-");

const twin = [
  "/** Sums the fees of a list of fills, in base units. */",
  "export function totalFees(fees: readonly bigint[]): bigint {",
  "  let total = 0n;",
  "  for (const fee of fees) {",
  "    if (fee < 0n) {",
  '      throw new RangeError("A fee is never negative.");',
  "    }",
  "    total += fee;",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

const layoutCases: readonly GateCase[] = [
  failingCase(
    "a utils.ts fails check:layout",
    fixturePackage("core", { "utils.ts": "export const one: number = 1;\n" }),
    ["check:layout", /check:layout\(file-name\): packages\/core\/src\/utils\.ts/],
  ),
  failingCase(
    "a package without AGENTS.md fails check:layout",
    fixturePackage(sampleKey, {}, { omit: ["AGENTS.md"] }),
    ["check:layout", /packages\/sample has no AGENTS\.md/],
  ),
  failingCase(
    "a CLAUDE.md other than @AGENTS.md fails check:layout",
    { ...fixturePackage("core", {}), "packages/core/CLAUDE.md": "Read the rules first.\n" },
    ["check:layout", /check:layout\(claude-md\): packages\/core\/CLAUDE\.md/],
  ),
  failingCase("a shell script fails check:layout", { "scripts/setup.sh": "echo setup\n" }, [
    "check:layout",
    /check:layout\(shell-script\): scripts\/setup\.sh/,
  ]),
];

const suppressionCases: readonly GateCase[] = [
  {
    name: "a blanket suppression fails Oxlint and check:suppressions",
    files: fixturePackage("core", {
      "loose.ts": `/* ${disable} */\nexport const one: number = 1;\n`,
    }),
    steps: [
      { command: ["pnpm", "lint"], expect: "fail", output: [/no-abusive-eslint-disable/] },
      { command: ["pnpm", "check:suppressions"], expect: "fail", output: [/names the rules/] },
    ],
  },
  failingCase(
    "an unused suppression fails Oxlint",
    fixturePackage("core", {
      "typed.ts": `// ${disable}-next-line typescript/no-explicit-any -- the value has a type\nexport const one: number = 1;\n`,
    }),
    ["lint", /[Uu]nused/],
  ),
  failingCase(
    "a suppression without a reason fails check:suppressions",
    fixturePackage("core", {
      "loose.ts": `// ${disable}-next-line typescript/no-explicit-any\nexport const one: any = 1;\n`,
    }),
    ["check:suppressions", /gives its reason/],
  ),
  failingCase(
    "a new entry in the size baseline fails check:suppressions",
    { "config/size-baseline.txt": "packages/core/src/big.ts\n" },
    ["check:suppressions", /only shrinks/],
  ),
];

function dependencyCases(repo: string): readonly GateCase[] {
  const workspace = readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8");
  return [
    failingCase(
      "a caret version fails check:deps-policy",
      { "pnpm-workspace.yaml": workspace.replace(/^ {2}typescript: /m, "  typescript: ^") },
      ["check:deps-policy", /pins typescript to \^/],
    ),
    failingCase(
      "an age exclusion past its removal date fails check:deps-policy",
      {
        "pnpm-workspace.yaml": workspace.replace(
          /remove after \d{4}-\d{2}-\d{2}/,
          "remove after 2026-01-01",
        ),
      },
      ["check:deps-policy", /was due for removal on 2026-01-01/],
    ),
  ];
}

const codeCases: readonly GateCase[] = [
  failingCase(
    "a dead export fails knip",
    fixturePackage("core", {
      "index.ts": 'export { ready } from "./ready.js";\n',
      "ready.ts": "export const ready: number = 1;\nexport const unused: number = 2;\n",
    }),
    ["deadcode", /Unused exports[\s\S]*unused/],
  ),
  failingCase(
    "a duplicated block fails jscpd",
    fixturePackage("core", { "fees.ts": twin, "fees-again.ts": twin }),
    ["dup:check", /Found [1-9]\d* clones/],
  ),
  failingCase("a broken heading fails markdownlint", { "notes.md": "#Notes\n\nText.\n" }, [
    "lint:docs",
    /MD018/,
  ]),
];

/** Cases for check:layout, check:suppressions, check:deps-policy, knip, jscpd and markdownlint. */
export function hygieneCases(repo: string): readonly GateCase[] {
  return [...layoutCases, ...suppressionCases, ...dependencyCases(repo), ...codeCases];
}
