import type { ProgramExit } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { hostOn } from "../e2e/test-host.js";
import { failingChecks, installedChecks, newFailures } from "./check-verdict.js";
import { installedProgramOf } from "./installed-program.js";

const live = (): AbortSignal => new AbortController().signal;
const machine = { folder: "/state", clock: undefined, signals: undefined };

function hostPrinting(stdout: string) {
  const runs: { file: string; args: readonly string[] }[] = [];
  const host = {
    ...hostOn(machine as never, []),
    runProgram: async (file: string, args: readonly string[]): Promise<ProgramExit> => {
      runs.push({ file, args });
      return Promise.resolve({ exitCode: 1, stdout, stderr: "" });
    },
  };
  return { host, runs };
}

describe("the new version's verdict", () => {
  it("fails only on a check the old version passed", () => {
    expect(newFailures(["plugins.sandbox"], ["plugins.sandbox", "engine.reachable"])).toStrictEqual(
      ["engine.reachable"],
    );
    expect(
      failingChecks([
        { check: "config.valid", level: "ok" },
        { check: "engine.reachable", level: "fail" },
        { check: "engine.reachable", level: "fail" },
      ]),
    ).toStrictEqual(["engine.reachable"]);
  });

  it("runs the installed program's own check and reads its last JSON line", async () => {
    const findings = JSON.stringify({ findings: [{ check: "smoke.broken", level: "fail" }] });
    const { host, runs } = hostPrinting(`A line for people\n${findings}\n`);

    await expect(installedChecks(host, live())).resolves.toStrictEqual(["smoke.broken"]);
    expect(runs).toStrictEqual([
      {
        file: host.entry.node,
        args: [...host.entry.nodeOptions, host.entry.script, "check", "--json"],
      },
    ]);
  });

  it("has no verdict from a check that printed no findings", async () => {
    await expect(installedChecks(hostPrinting("crashed\n").host, live())).resolves.toBeUndefined();
  });
});

// How a program at the script, with the variables given, was installed.
function installedFrom(script: string, env: Readonly<Record<string, string>> = {}) {
  return installedProgramOf({ entry: { node: "node", nodeOptions: [], script }, env });
}

describe("how binference was installed", () => {
  it("knows an npm prefix, the image and a checkout", () => {
    const npm = "/usr/local/lib/node_modules/binference/dist/main.mjs";

    expect([
      installedFrom(npm),
      installedFrom(npm, { BINFERENCE_IMAGE_USER: "10001" }),
      installedFrom("/opt/binference/packages/cli/dist/main.mjs"),
    ]).toStrictEqual([
      { kind: "npm", prefix: "/usr/local" },
      { kind: "image" },
      { kind: "other", folder: "/opt/binference/packages/cli" },
    ]);
  });
});
