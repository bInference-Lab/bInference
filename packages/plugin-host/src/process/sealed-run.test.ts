import { describe, expect, it } from "vitest";
import { pluginNodeArguments } from "./plugin-node-arguments.js";
import { isSealedRun } from "./sealed-run.js";

const folders = { packageFolder: "/plugins/fear/package", dataFolder: "/plugins/fear/data" };
const hostFlags = pluginNodeArguments("/opt/plugin-process.mjs", folders).slice(0, -1);
const noGrant = { has: () => false };

describe("isSealedRun", () => {
  it("holds for the host's own flags under the permission model with no grant", () => {
    expect(isSealedRun({ permission: noGrant, execArgv: hostFlags, nodeOptions: undefined })).toBe(
      true,
    );
  });

  it.each([
    ["V8's internal functions", "--allow-natives-syntax"],
    ["Node's internals", "--expose-internals"],
    ["a network grant", "--allow-net"],
    ["a loader", "--import=/plugins/fear/data/loader.mjs"],
    ["the inspector", "--inspect=0"],
  ])("refuses one more flag that turns on %s", (_name, flag) => {
    const execArgv = [...hostFlags, flag];

    expect(isSealedRun({ permission: noGrant, execArgv, nodeOptions: undefined })).toBe(false);
  });

  it("refuses a run without the debug-signal switch, or with NODE_OPTIONS set", () => {
    const withoutSwitch = hostFlags.filter((flag) => flag !== "--disable-sigusr1");

    expect(
      isSealedRun({ permission: noGrant, execArgv: withoutSwitch, nodeOptions: undefined }),
    ).toBe(false);
    expect(
      isSealedRun({
        permission: noGrant,
        execArgv: hostFlags,
        nodeOptions: "--allow-natives-syntax",
      }),
    ).toBe(false);
  });

  it("refuses a run outside the permission model, or with any grant past its folders", () => {
    const allReads = { has: (scope: string) => scope === "fs.read" };

    expect(
      isSealedRun({ permission: undefined, execArgv: hostFlags, nodeOptions: undefined }),
    ).toBe(false);
    expect(isSealedRun({ permission: allReads, execArgv: hostFlags, nodeOptions: undefined })).toBe(
      false,
    );
  });
});
