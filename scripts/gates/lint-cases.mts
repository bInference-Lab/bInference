import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase } from "./gate-case.mjs";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Every expected finding names the planted file and the rule, so a case cannot pass on a
// finding from somewhere else. The unix format prints one finding per line wherever it runs.
function lintCase(
  name: string,
  files: Readonly<Record<string, string>>,
  findings: readonly (readonly [file: string, rule: string])[],
): GateCase {
  return {
    name,
    files,
    steps: [
      {
        command: ["pnpm", "lint", "--format", "unix"],
        expect: "fail",
        output: findings.map(
          ([file, rule]) =>
            new RegExp(`${escapeRegex(file)}:\\d+:\\d+: .*\\[Error/${escapeRegex(rule)}\\]`),
        ),
      },
    ],
  };
}

// The real core holds the one error class; the case adds a cli that reads the environment.
// Planted beside the real cli package, which other packages and the gate scripts import.
const cleanFiles = {
  "packages/cli/src/home.ts": [
    "/** Reads the home folder from the environment. */",
    'export const home: string | undefined = process.env["HOME"];',
    "",
  ].join("\n"),
};

const guardCases: readonly GateCase[] = [
  lintCase(
    "a boolean parameter fails guards/no-boolean-param",
    fixturePackage("store", {
      "pick.ts": "export function pick(flag: boolean): number {\n  return flag ? 1 : 0;\n}\n",
    }),
    [["packages/store/src/pick.ts", "guards(no-boolean-param)"]],
  ),
  lintCase(
    "new Date() in core fails guards/no-argless-date",
    fixturePackage("core", {
      "now.ts": "export function now(): Date {\n  return new Date();\n}\n",
    }),
    [["packages/core/src/now.ts", "guards(no-argless-date)"]],
  ),
  lintCase(
    "a class other than the error class fails guards/no-class",
    fixturePackage("core", { "thing.ts": "export class Thing {}\n" }),
    [["packages/core/src/thing.ts", "guards(no-class)"]],
  ),
  lintCase(
    "a file of re-exports fails guards/no-reexport-file",
    fixturePackage("core", { "again.ts": 'export { ready } from "./index.js";\n' }),
    [["packages/core/src/again.ts", "guards(no-reexport-file)"]],
  ),
  lintCase(
    "an I-prefixed interface fails guards/no-interface-prefix",
    fixturePackage("core", {
      "thing.ts": "export interface IThing {\n  readonly id: string;\n}\n",
    }),
    [["packages/core/src/thing.ts", "guards(no-interface-prefix)"]],
  ),
  lintCase(
    "a type name outside PascalCase fails guards/type-pascal-case",
    fixturePackage("core", { "label.ts": "export type label = string;\n" }),
    [["packages/core/src/label.ts", "guards(type-pascal-case)"]],
  ),
  lintCase(
    "fetch without a signal fails guards/require-abort-signal",
    fixturePackage("server", {
      "load.ts": [
        "export async function load(url: string): Promise<Response> {",
        "  return fetch(url);",
        "}",
        "",
      ].join("\n"),
    }),
    [["packages/server/src/load.ts", "guards(require-abort-signal)"]],
  ),
];

const importCases: readonly GateCase[] = [
  lintCase(
    "chain importing engine fails eslint/no-restricted-imports",
    {
      ...fixturePackage("engine", {}),
      ...fixturePackage("chain", {
        "uses-engine.ts":
          'import { ready } from "@binference/engine";\n\nexport const twice: number = ready * 2;\n',
      }),
    },
    [["packages/chain/src/uses-engine.ts", "eslint(no-restricted-imports)"]],
  ),
  lintCase(
    "two files importing each other fail import/no-cycle",
    fixturePackage("store", {
      "first.ts":
        'import { second } from "./second.js";\n\nexport const first = (): number => second() + 1;\n',
      "second.ts":
        'import { first } from "./first.js";\n\nexport const second = (): number => first() - 1;\n',
    }),
    [
      ["packages/store/src/first.ts", "import(no-cycle)"],
      ["packages/store/src/second.ts", "import(no-cycle)"],
    ],
  ),
  lintCase(
    "process.env outside cli fails node/no-process-env",
    fixturePackage("platform", {
      "home.ts": 'export const home: string | undefined = process.env["HOME"];\n',
    }),
    [["packages/platform/src/home.ts", "node(no-process-env)"]],
  ),
];

const typeCases: readonly GateCase[] = [
  lintCase(
    "any and a default export fail their rules",
    fixturePackage("core", {
      "loose.ts": "const loose: any = 1;\n\nexport default loose;\n",
    }),
    [
      ["packages/core/src/loose.ts", "typescript(no-explicit-any)"],
      ["packages/core/src/loose.ts", "import(no-default-export)"],
    ],
  ),
  lintCase(
    "a floating promise and a switch with a missing case fail the type-aware rules",
    fixturePackage("store", {
      "work.ts": [
        "async function work(): Promise<void> {}",
        "",
        "export function start(): void {",
        "  work();",
        "}",
        "",
        'export function name(kind: "a" | "b"): string {',
        "  switch (kind) {",
        '    case "a":',
        '      return "A";',
        "  }",
        '  return "?";',
        "}",
        "",
      ].join("\n"),
    }),
    [
      ["packages/store/src/work.ts", "typescript(no-floating-promises)"],
      ["packages/store/src/work.ts", "typescript(switch-exhaustiveness-check)"],
    ],
  ),
];

/** Cases for Oxlint, its guards plugin, oxfmt and tsc. */
export function lintCases(): readonly GateCase[] {
  return [
    {
      name: "the error class in core and process.env in cli lint clean",
      files: cleanFiles,
      steps: [{ command: ["pnpm", "lint"], expect: "pass" }],
    },
    ...guardCases,
    ...importCases,
    ...typeCases,
    {
      name: "an unformatted file fails oxfmt --check",
      files: fixturePackage("core", { "point.ts": "export const point = {x:1,y:2}\n" }),
      steps: [{ command: ["pnpm", "format:check"], expect: "fail", output: [/point\.ts/] }],
    },
    {
      name: "tsc refuses undefined in an optional field and an enum",
      files: fixturePackage("core", {
        "shapes.ts": [
          "interface Shape {",
          "  readonly label?: string;",
          "}",
          "export const shape: Shape = { label: undefined };",
          "export enum Side {",
          "  Buy,",
          "}",
          "",
        ].join("\n"),
      }),
      steps: [{ command: ["pnpm", "typecheck"], expect: "fail", output: [/TS2375/, /TS1294/] }],
    },
  ];
}
