import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackages } from "../package-graph/graph.mjs";
import type { GateCase } from "./gate-case.mjs";

const rootFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc"];

// The lockfile names every workspace package, so a frozen install needs their manifests too.
function engineFiles(repo: string): readonly string[] {
  return [...rootFiles, ...findPackages(repo).map((item) => `${item.folder}/package.json`)];
}

// The install runs in its own folder, so a gate that wrongly passes installs there and never
// touches the linked node_modules.
function engineCase(repo: string, nodeVersion: string, expect: "pass" | "fail"): GateCase {
  const files = Object.fromEntries(
    engineFiles(repo).map((file) => [
      join(".gates", "engines", file),
      readFileSync(join(repo, file), "utf8"),
    ]),
  );
  return {
    name: `pnpm install on Node ${nodeVersion} ${expect === "fail" ? "is refused" : "runs"}`,
    files,
    steps: [
      {
        command: [
          "pnpm",
          "install",
          "--prefer-offline",
          "--frozen-lockfile",
          `--config.node-version=${nodeVersion}`,
        ],
        cwd: join(".gates", "engines"),
        expect,
        output: expect === "fail" ? [/Unsupported engine/] : [],
      },
    ],
  };
}

/** Cases for the workspace: the Node range and the package generator. */
export function workspaceCases(repo: string): readonly GateCase[] {
  return [
    engineCase(repo, "24.16.0", "fail"),
    engineCase(repo, "26.0.0", "fail"),
    engineCase(repo, "26.1.0", "pass"),
    {
      name: "pnpm gen:package demo makes a package that builds through Turborepo and tests",
      cost: 6,
      steps: [
        { command: ["pnpm", "gen:package", "demo"], expect: "pass" },
        { command: ["pnpm", "install", "--prefer-offline"], expect: "pass" },
        // Only the new package and what it imports: a full build and test run grows with the repo.
        {
          command: ["pnpm", "turbo", "run", "build", "--filter=@binference/demo..."],
          expect: "pass",
          output: [/index\.mjs/, /index\.d\.mts/],
        },
        { command: ["pnpm", "typecheck"], expect: "pass" },
        {
          command: ["pnpm", "exec", "vitest", "run", "packages/demo/", "--reporter=verbose"],
          expect: "pass",
          output: [/✓ .*matches the name its manifest declares/],
        },
      ],
    },
  ];
}
