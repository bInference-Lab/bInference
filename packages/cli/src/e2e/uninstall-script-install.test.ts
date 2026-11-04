import { dirname, join } from "node:path";
import type { ProgramExit } from "@binference/platform";
import {
  ensureReadableFolder,
  fileSize,
  listFolderFiles,
  writeReadableFile,
} from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type Home, onHome, setUpHome } from "./home-fixtures.js";
import type { HostParts } from "./test-host.js";
import { testSystem } from "./test-host.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const homes: Home[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.services.logout()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** The install script's data folder under a home, as decision 0357 lays it out. */
interface ScriptLayout {
  readonly data: string;
  readonly script: string;
  readonly node: string;
  /** A Node of the owner's, outside the data folder, which uninstall must never touch. */
  readonly ownNode: string;
}

async function write(file: string, text: string): Promise<void> {
  await ensureReadableFolder(dirname(file), signal());
  await writeReadableFile(file, Buffer.from(text), signal());
}

// The data folder with the package in `npm/`, the launcher in `bin/` and, when `pinnedNode`, the
// Node the script installed in `node/`; the launcher's first lines are the script's own.
async function lay(
  home: Home,
  options: { readonly pinnedNode: boolean; readonly windows: boolean },
): Promise<ScriptLayout> {
  const data = join(home.home, ".local", "share", "binference");
  const modules = options.windows ? ["npm"] : ["npm", "lib"];
  const script = join(data, ...modules, "node_modules", "binference", "dist", "main.mjs");
  const ownNode = join(home.home, "own-node", "bin", "node");
  const pinned = options.windows
    ? join(data, "node", "current", "node.exe")
    : join(data, "node", "current", "bin", "node");
  await write(script, "// binference\n");
  await write(ownNode, "an owner's Node\n");
  if (options.pinnedNode) {
    await write(pinned, "the pinned Node\n");
    await write(join(data, "node", "node-v26.13.0-linux-x64", "bin", "node"), "the pinned Node\n");
  }
  const launcher = options.windows
    ? [
        "@echo off",
        "rem Written by the binference installer: runs binference with the Node it chose.",
      ]
    : [
        "#!/bin/sh",
        "# Written by the binference installer: runs binference with the Node it chose.",
      ];
  await write(
    join(data, "bin", options.windows ? "binference.cmd" : "binference"),
    `${launcher.join("\n")}\n`,
  );
  return { data, script, node: options.pinnedNode ? pinned : ownNode, ownNode };
}

// Records each program run, so a test sees that no npm ran.
function recorder() {
  const runs: (readonly [string, readonly string[]])[] = [];
  const runProgram = async (file: string, args: readonly string[]): Promise<ProgramExit> => {
    runs.push([file, args]);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };
  return { runs, runProgram };
}

function entryOf(layout: ScriptLayout): HostParts {
  return { entry: { node: layout.node, nodeOptions: [], script: layout.script } };
}

async function exists(path: string): Promise<boolean> {
  return (await fileSize(path, signal())).ok;
}

describe("binference uninstall after the install script", () => {
  it(
    "removes the program, the launcher and the pinned Node, and names the PATH line",
    slow,
    async () => {
      const home = await setUpHome(folders);
      homes.push(home);
      const layout = await lay(home, { pinnedNode: true, windows: false });
      const npm = recorder();

      const removed = await onHome(home, ["uninstall", "--yes"], {
        ...entryOf(layout),
        runProgram: npm.runProgram,
      });

      expect([removed.code, removed.stderr]).toStrictEqual([0, ""]);
      expect(removed.stdout).toContain(
        `The launcher and the Node the install script put in ${layout.data} are removed too.`,
      );
      expect(removed.stdout).toContain(`  export PATH="${join(layout.data, "bin")}:$PATH"`);
      await expect(listFolderFiles(layout.data, signal())).resolves.toStrictEqual([]);
      await expect(exists(join(layout.data, "bin"))).resolves.toBe(false);
      await expect(exists(layout.ownNode)).resolves.toBe(true);
      expect(npm.runs).toStrictEqual([]);
    },
  );

  it("keeps the Node the machine had and a file of the owner's", slow, async () => {
    const home = await setUpHome(folders);
    homes.push(home);
    const layout = await lay(home, { pinnedNode: false, windows: false });
    await write(join(layout.data, "notes.txt"), "the owner's\n");

    const removed = await onHome(home, ["uninstall", "--yes"], entryOf(layout));

    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain(
      `The launcher the install script put in ${layout.data} is removed too.`,
    );
    await expect(listFolderFiles(layout.data, signal())).resolves.toStrictEqual(["notes.txt"]);
    await expect(exists(layout.ownNode)).resolves.toBe(true);
  });

  it("leaves a launcher the install script did not write to npm", slow, async () => {
    const home = await setUpHome(folders);
    homes.push(home);
    const layout = await lay(home, { pinnedNode: false, windows: false });
    await write(join(layout.data, "bin", "binference"), "#!/bin/sh\nexec my-binference\n");
    const npm = recorder();

    const removed = await onHome(home, ["uninstall", "--yes"], {
      ...entryOf(layout),
      runProgram: npm.runProgram,
    });

    expect(removed.code).toBe(0);
    expect(npm.runs).toStrictEqual([
      ["npm", ["uninstall", "--global", "--prefix", join(layout.data, "npm"), "binference"]],
    ]);
    await expect(exists(join(layout.data, "bin", "binference"))).resolves.toBe(true);
  });

  it("prints the command that removes what the script put in place on Windows", slow, async () => {
    const home = await setUpHome(folders);
    homes.push(home);
    const layout = await lay(home, { pinnedNode: true, windows: true });
    const bin = join(layout.data, "bin");

    const removed = await onHome(home, ["uninstall", "--yes"], {
      ...entryOf(layout),
      system: { ...testSystem, os: "win32" },
    });

    expect(removed.code).toBe(0);
    const parts = ["npm", "node", join("bin", "binference.cmd")].map(
      (part) => `'${join(layout.data, part)}'`,
    );
    expect(removed.stdout).toContain(
      `remove binference once this command ends: Remove-Item -Recurse -Force -LiteralPath ${parts.join(", ")}`,
    );
    expect(removed.stdout).toContain(`If you added ${bin} to your user PATH, remove it`);
    await expect(exists(join(bin, "binference.cmd"))).resolves.toBe(true);
  });
});
