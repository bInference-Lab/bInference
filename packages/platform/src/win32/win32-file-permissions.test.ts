import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { filePermissionsContract } from "../contracts/file-permissions-contract.js";
import { ensurePrivateFolder, writePrivateFile } from "../private-files.js";
import { runCommand } from "../run-command.js";
import { createWin32FilePermissions } from "./win32-file-permissions.js";

const sid = "S-1-5-21-1004336348-1177238915-682003330-1001";
const whoamiOutput = `"desktop-7\\owner","${sid}"\r\n`;

interface Call {
  readonly file: string;
  readonly args: readonly string[];
}

// Answers whoami with each output in turn, the last one from then on, and icacls with nothing.
function recordingRun(whoamiOutputs: readonly string[] = [whoamiOutput]) {
  const calls: Call[] = [];
  const answers = [...whoamiOutputs];
  const run = async (
    file: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<string> => {
    signal.throwIfAborted();
    await Promise.resolve();
    calls.push({ file, args });
    if (file !== "whoami") {
      return "";
    }
    return answers.length > 1 ? (answers.shift() ?? "") : (answers[0] ?? "");
  };
  return { calls, run };
}

describe("windows file permissions, with a recorded command runner", () => {
  it("removes inherited access and grants the owner, folders for their children too", async () => {
    const { calls, run } = recordingRun();
    const permissions = createWin32FilePermissions({ run });
    const signal = new AbortController().signal;

    await permissions.restrictFolder("D:\\binference", signal);
    await permissions.restrictFile("D:\\binference\\config.json5", signal);

    expect(calls).toStrictEqual([
      { file: "whoami", args: ["/user", "/fo", "csv", "/nh"] },
      {
        file: "icacls",
        args: ["D:\\binference", "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)(F)`],
      },
      {
        file: "icacls",
        args: ["D:\\binference\\config.json5", "/inheritance:r", "/grant:r", `*${sid}:(F)`],
      },
    ]);
  });

  it("refuses to guess the owner when whoami names no account", async () => {
    const { run } = recordingRun(["ERROR: no user\r\n"]);
    const permissions = createWin32FilePermissions({ run });

    await expect(
      permissions.restrictFile("C:\\state\\a", new AbortController().signal),
    ).rejects.toMatchObject({ code: "platform.owner_unknown" });
  });

  it("asks whoami again after a failed lookup", async () => {
    const { calls, run } = recordingRun(["", whoamiOutput]);
    const permissions = createWin32FilePermissions({ run });
    const signal = new AbortController().signal;

    await expect(permissions.restrictFile("C:\\state\\a", signal)).rejects.toBeInstanceOf(
      BinferenceError,
    );
    await permissions.restrictFile("C:\\state\\a", signal);

    expect(calls.map((call) => call.file)).toStrictEqual(["whoami", "whoami", "icacls"]);
  });

  it("stops before running anything on an aborted signal", async () => {
    const { calls, run } = recordingRun();
    const permissions = createWin32FilePermissions({ run });
    const reason = new Error("stopped");

    await expect(permissions.restrictFolder("C:\\state", AbortSignal.abort(reason))).rejects.toBe(
      reason,
    );
    expect(calls).toStrictEqual([]);
  });
});

// Runs only on Windows: icacls lists each access entry of a path, and whoami names the owner.
async function aclEntries(path: string): Promise<readonly string[]> {
  const signal = AbortSignal.timeout(15_000);
  const output = await runCommand("icacls", [path], signal);
  const [first = "", ...rest] = output.split(/\r?\n/);
  const end = rest.findIndex((line) => line.trim() === "");
  return [first.slice(path.length), ...rest.slice(0, end)].map((line) => line.trim());
}

async function isOwnerOnly(path: string): Promise<boolean> {
  const owner = (await runCommand("whoami", [], AbortSignal.timeout(15_000))).trim();
  const entries = await aclEntries(path);
  return (
    entries.length === 1 &&
    entries.every(
      (entry) =>
        entry.toLowerCase().startsWith(`${owner.toLowerCase()}:`) && !entry.includes("(I)"),
    )
  );
}

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe.runIf(process.platform === "win32")("windows file permissions", () => {
  it.each(
    filePermissionsContract({
      create: async () => ({
        permissions: createWin32FilePermissions(),
        folder: await scratchFolder(),
      }),
      isOwnerOnly,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes a file another user cannot read, over an older file others could", async () => {
    const permissions = createWin32FilePermissions();
    const folder = join(await scratchFolder(), "state");
    const file = join(folder, "config.json5");
    const signal = AbortSignal.timeout(30_000);
    await mkdir(folder);
    await writeFile(file, "old");

    await ensurePrivateFolder(folder, { permissions, signal });
    await writePrivateFile(file, "{ engine: {} }", { permissions, signal });

    await expect(isOwnerOnly(folder)).resolves.toBe(true);
    await expect(isOwnerOnly(file)).resolves.toBe(true);
    await expect(readFile(file, "utf8")).resolves.toBe("{ engine: {} }");
  });
});
