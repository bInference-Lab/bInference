import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { filePermissionsContract } from "../contracts/file-permissions-contract.js";
import { ensurePrivateFolder, writePrivateFile } from "../private-files.js";
import { runCommand } from "../run-command.js";
import { createWin32FilePermissions } from "./win32-file-permissions.js";

const sid = "S-1-5-21-1004336348-1177238915-682003330-1001";
const systemSid = "S-1-5-18";
const administratorsSid = "S-1-5-32-544";
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
  it("removes inherited access and grants the owner, SYSTEM and Administrators, and folders their children", async () => {
    const { calls, run } = recordingRun();
    const permissions = createWin32FilePermissions({ run });
    const signal = new AbortController().signal;

    await permissions.restrictFolder("D:\\binference", signal);
    await permissions.restrictFile("D:\\binference\\config.json5", signal);

    expect(calls).toStrictEqual([
      { file: "whoami", args: ["/user", "/fo", "csv", "/nh"] },
      {
        file: "icacls",
        args: [
          "D:\\binference",
          "/inheritance:r",
          "/grant:r",
          `*${sid}:(OI)(CI)(F)`,
          "/grant:r",
          `*${systemSid}:(OI)(CI)(F)`,
          "/grant:r",
          `*${administratorsSid}:(OI)(CI)(F)`,
        ],
      },
      {
        file: "icacls",
        args: [
          "D:\\binference\\config.json5",
          "/inheritance:r",
          "/grant:r",
          `*${sid}:(F)`,
          "/grant:r",
          `*${systemSid}:(F)`,
          "/grant:r",
          `*${administratorsSid}:(F)`,
        ],
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

// Runs only on Windows. PowerShell reads the access list through .NET by security id, so no
// account name or its language is compared, and no PowerShell module has to load (loading one
// scans every module folder, which takes seconds on a CI runner). Each line is a word and values.
const aclSchema = z.object({
  protected: z.boolean(),
  user: z.string(),
  rules: z.array(z.object({ sid: z.string(), inherited: z.boolean(), allow: z.number() })),
});

function aclScript(path: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$path = '${path.replaceAll("'", "''")}'`,
    "$acl = if ([IO.Directory]::Exists($path)) { [IO.Directory]::GetAccessControl($path) } else { [IO.File]::GetAccessControl($path) }",
    "$out = [Console]::Out",
    "$out.WriteLine('protected ' + $acl.AreAccessRulesProtected)",
    "$out.WriteLine('user ' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)",
    "foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { $out.WriteLine('rule ' + $rule.IdentityReference.Value + ' ' + $rule.IsInherited + ' ' + [int]$rule.AccessControlType) }",
  ].join("; ");
}

function parseAcl(output: string): z.infer<typeof aclSchema> {
  const lines = output.split(/\r?\n/).map((line) => line.trim().split(" "));
  const value = (word: string): string | undefined => lines.find(([first]) => first === word)?.[1];
  return aclSchema.parse({
    protected: value("protected") === "True",
    user: value("user"),
    rules: lines
      .filter(([first]) => first === "rule")
      .map(([, ruleSid, inherited, allow]) => ({
        sid: ruleSid,
        inherited: inherited === "True",
        allow: Number(allow),
      })),
  });
}

async function accessProblems(path: string): Promise<readonly string[]> {
  const args = ["-NoProfile", "-NonInteractive", "-Command", aclScript(path)];
  const output = await runCommand("powershell.exe", args, AbortSignal.timeout(15_000));
  const acl = parseAcl(output);
  const trusted = new Set([acl.user, systemSid, administratorsSid]);
  return [
    ...(acl.protected ? [] : ["inherits access from its folder"]),
    ...acl.rules.filter((rule) => rule.inherited).map((rule) => `${rule.sid} inherited`),
    ...acl.rules.filter((rule) => !trusted.has(rule.sid)).map((rule) => `${rule.sid} listed`),
    ...(acl.rules.some((rule) => rule.sid === acl.user && rule.allow === 0)
      ? []
      : ["the owner has no entry"]),
  ];
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

// Each case starts icacls, whoami and Windows PowerShell, which take seconds on a CI runner.
const osTestTimeoutMs = 60_000;

describe.runIf(process.platform === "win32")("windows file permissions", () => {
  it.each(
    filePermissionsContract({
      create: async () => ({
        permissions: createWin32FilePermissions(),
        folder: await scratchFolder(),
      }),
      accessProblems,
    }),
  )(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    osTestTimeoutMs,
  );

  it(
    "writes a file another user cannot read, over an older file others could",
    async () => {
      const permissions = createWin32FilePermissions();
      const folder = join(await scratchFolder(), "state");
      const file = join(folder, "config.json5");
      const signal = AbortSignal.timeout(30_000);
      await mkdir(folder);
      await writeFile(file, "old");

      await ensurePrivateFolder(folder, { permissions, signal });
      await writePrivateFile(file, "{ engine: {} }", { permissions, signal });

      await expect(accessProblems(folder)).resolves.toStrictEqual([]);
      await expect(accessProblems(file)).resolves.toStrictEqual([]);
      await expect(readFile(file, "utf8")).resolves.toBe("{ engine: {} }");
    },
    osTestTimeoutMs,
  );
});
