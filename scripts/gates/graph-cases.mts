import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintConfigPath } from "../package-graph/lint-config.mjs";
import { fixturePackage } from "./fixture-package.mjs";
import type { GateCase } from "./gate-case.mjs";

const writeGraph = ["pnpm", "check:package-graph", "--write"];
const checkGraph = ["pnpm", "check:package-graph"];

/** Cases for check:package-graph. */
export function graphCases(repo: string): readonly GateCase[] {
  const generated = readFileSync(join(repo, lintConfigPath), "utf8");
  return [
    {
      name: "a package inside its row passes check:package-graph",
      files: {
        ...fixturePackage("core", {}),
        ...fixturePackage("chain", {}, { dependencies: { "@binference/core": "workspace:*" } }),
      },
      steps: [
        { command: writeGraph, expect: "pass" },
        { command: checkGraph, expect: "pass", output: [/\d+ packages match/] },
      ],
    },
    {
      name: "a dependency outside the row fails check:package-graph",
      files: fixturePackage("chain", {}, { dependencies: { "@binference/engine": "workspace:*" } }),
      steps: [{ command: writeGraph, expect: "fail", output: [/depends on @binference\/engine/] }],
    },
    {
      name: "a hand edit to the generated blocklist fails check:package-graph",
      files: { [lintConfigPath]: generated.replace('"node:vm"', '"node:vm2"') },
      steps: [{ command: checkGraph, expect: "fail", output: [/does not match/] }],
    },
    {
      name: "a package without a row fails check:package-graph",
      files: fixturePackage("wallet", {}),
      steps: [{ command: writeGraph, expect: "fail", output: [/has no row/] }],
    },
  ];
}

/** Cases for check:tsconfig. */
export function tsconfigCases(): readonly GateCase[] {
  return [
    {
      name: "a package tsconfig that turns off a base flag fails check:tsconfig",
      files: fixturePackage(
        "core",
        {},
        {
          tsconfig: {
            extends: "../../tsconfig.base.json",
            compilerOptions: { strict: false },
            include: ["src"],
          },
        },
      ),
      steps: [{ command: ["pnpm", "check:tsconfig"], expect: "fail", output: [/sets strict/] }],
    },
    {
      name: "a package tsconfig that skips the base fails check:tsconfig",
      files: fixturePackage("core", {}, { tsconfig: { include: ["src"] } }),
      steps: [{ command: ["pnpm", "check:tsconfig"], expect: "fail", output: [/must extend/] }],
    },
  ];
}
