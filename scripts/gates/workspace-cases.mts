import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";

const engineFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc"];

// The install runs in its own folder, so a gate that wrongly passes installs there and never
// touches the linked node_modules.
function engineCase(repo: string, nodeVersion: string, expect: "pass" | "fail"): GateCase {
  const files = Object.fromEntries(
    engineFiles.map((file) => [
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
      steps: [
        { command: ["pnpm", "gen:package", "demo"], expect: "pass" },
        { command: ["pnpm", "install", "--prefer-offline"], expect: "pass" },
        {
          command: ["pnpm", "build"],
          expect: "pass",
          output: [/index\.mjs/, /index\.d\.mts/],
        },
        { command: ["pnpm", "typecheck"], expect: "pass" },
        { command: ["pnpm", "test"], expect: "pass", output: [/1 passed/] },
      ],
    },
  ];
}
