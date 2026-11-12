import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { commandWallContract } from "../contracts/command-wall-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import type { ProgramExit, RunToExit } from "../run-command.js";
import { createLinuxCommandWall } from "./linux-command-wall.js";

const folders: TempFolder[] = [];

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-wall-");
  folders.push(folder);
  return realpathSync(folder.path);
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const bwrap = "/usr/bin/bwrap";
const walled = { roots: ["/srv/state"], open: ["/srv/state/workspace"] };
const wallArgs = [
  "--dev-bind",
  "/",
  "/",
  "--tmpfs",
  "/srv/state",
  "--bind-try",
  "/srv/state/workspace",
  "/srv/state/workspace",
  "--",
];
const ran: ProgramExit = { exitCode: 0, stdout: "", stderr: "" };
const namespaceRefused: ProgramExit = {
  exitCode: 1,
  stdout: "",
  stderr: "bwrap: Creating new namespace failed: Operation not permitted\n",
};
const signal = (): AbortSignal => AbortSignal.timeout(15_000);

// A runner that answers each run with the next exit given, a function's throw for one that never
// ran to its end, and records every run.
function fakeRunner(exits: readonly (ProgramExit | (() => never))[]) {
  const runs: (readonly string[])[] = [];
  const run: RunToExit = async (file, args, given) => {
    given.throwIfAborted();
    await Promise.resolve();
    runs.push([file, ...args]);
    const exit = exits[runs.length - 1] ?? ran;
    return typeof exit === "function" ? exit() : exit;
  };
  return { run, runs };
}

function neverRan(): never {
  throw new BinferenceError({ code: "platform.command_failed", message: "bwrap timed out." });
}

// A runner whose first run waits for `answerFirst`, and whose later runs end well at once.
function heldBackRunner() {
  const first: { settle?: (exit: ProgramExit) => void } = {};
  const firstExit = new Promise<ProgramExit>((settle) => {
    first.settle = settle;
  });
  const runs = { count: 0 };
  const run: RunToExit = async () => {
    runs.count += 1;
    return runs.count === 1 ? firstExit : ran;
  };
  return { run, answerFirst: (exit: ProgramExit) => first.settle?.(exit) };
}

const noWall = { code: "platform.no_wall" };

describe.skipIf(process.platform === "win32")("the linux command wall's check", () => {
  it("holds only after a command that does nothing ran through bwrap with the wall's arguments", async () => {
    const { run, runs } = fakeRunner([ran]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    expect(wall.state).toMatchObject({ kind: "none", cause: "untried" });
    expect(() => wall.wrap({ file: "/bin/cat", args: ["x"] })).toThrow(
      expect.objectContaining(noWall),
    );
    expect(await wall.check(signal())).toStrictEqual({ kind: "held", by: "bubblewrap" });
    expect(runs).toStrictEqual([[bwrap, ...wallArgs, "/bin/sh", "-c", ":"]]);
    expect(wall.wrap({ file: "/bin/cat", args: ["x"] })).toStrictEqual({
      file: bwrap,
      args: [...wallArgs, "/bin/cat", "x"],
    });
  });

  it("keeps a wall that held without trying it again", async () => {
    const { run, runs } = fakeRunner([ran, namespaceRefused]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    await wall.check(signal());
    expect(await wall.check(signal())).toStrictEqual({ kind: "held", by: "bubblewrap" });
    expect(runs).toHaveLength(1);
  });

  it("answers refused with bubblewrap's words where the machine refuses it a namespace", async () => {
    const { run } = fakeRunner([namespaceRefused]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    const state = await wall.check(signal());

    expect(state).toStrictEqual({
      kind: "none",
      cause: "refused",
      reason:
        "bwrap (bubblewrap) could not run a command here, as on a machine that refuses it " +
        "unprivileged user namespaces: bwrap: Creating new namespace failed: Operation not permitted.",
    });
    expect(wall.state).toStrictEqual(state);
    expect(() => wall.wrap({ file: "/bin/cat", args: ["x"] })).toThrow(
      expect.objectContaining(noWall),
    );
  });

  it("answers refused when bwrap never ran to its end", async () => {
    const { run } = fakeRunner([neverRan]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    expect(await wall.check(signal())).toMatchObject({ kind: "none", cause: "refused" });
  });

  it("tries again at the next check after a refusal, and holds once bwrap runs", async () => {
    const { run, runs } = fakeRunner([namespaceRefused, ran]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    expect(await wall.check(signal())).toMatchObject({ kind: "none", cause: "refused" });
    expect(await wall.check(signal())).toStrictEqual({ kind: "held", by: "bubblewrap" });
    expect(runs).toHaveLength(2);
  });

  it("answers missing without running anything while bwrap is not installed", async () => {
    const machine: { bwrap?: string } = {};
    const { run, runs } = fakeRunner([ran]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => machine.bwrap, run });

    expect(wall.state).toMatchObject({ kind: "none", cause: "missing" });
    expect(await wall.check(signal())).toMatchObject({ kind: "none", cause: "missing" });
    expect(runs).toStrictEqual([]);
    machine.bwrap = bwrap;
    expect(await wall.check(signal())).toStrictEqual({ kind: "held", by: "bubblewrap" });
  });

  it("keeps a wall that held when a check begun before it is refused after it", async () => {
    const { run, answerFirst } = heldBackRunner();
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });

    const slow = wall.check(signal());
    expect(await wall.check(signal())).toStrictEqual({ kind: "held", by: "bubblewrap" });
    answerFirst(namespaceRefused);

    expect(await slow).toStrictEqual({ kind: "held", by: "bubblewrap" });
    expect(wall.wrap({ file: "/bin/true", args: [] }).file).toBe(bwrap);
  });

  it("rejects with the signal's reason and keeps its answer when the check is stopped", async () => {
    const { run } = fakeRunner([ran]);
    const wall = createLinuxCommandWall(walled, { findBwrap: () => bwrap, run });
    const stopped = new AbortController();
    stopped.abort(new Error("stopped"));

    await expect(wall.check(stopped.signal)).rejects.toThrow("stopped");
    expect(wall.state).toMatchObject({ kind: "none", cause: "untried" });
  });
});

// CI runs this on Linux; it is skipped elsewhere. A Linux machine without bubblewrap, or one that
// refuses it namespaces, answers `none`, which the contract's no-mechanism check would cover;
// here bubblewrap must run.
describe.runIf(process.platform === "linux")("linux command wall", () => {
  it.each(
    commandWallContract({
      walls: true,
      create: async () => {
        const root = await scratch();
        const auth = join(root, "auth");
        await mkdir(auth);
        const deniedFile = join(auth, "cli.token");
        const deniedContent = "secret-owner-token";
        await writeFile(deniedFile, deniedContent);
        const openFolder = join(root, "workspace");
        await mkdir(openFolder);
        const allowedFile = join(await scratch(), "ok.txt");
        const allowedContent = "readable";
        await writeFile(allowedFile, allowedContent);
        const wall = createLinuxCommandWall({ roots: [root], open: [openFolder] });
        const files = { deniedFile, deniedContent, allowedFile, allowedContent, openFolder };
        return { wall, ...files, reader: "/bin/cat", linker: "/bin/ln" };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
