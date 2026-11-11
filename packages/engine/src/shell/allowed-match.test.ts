import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { judgeLine, runsOtherProgram } from "./allowed-match.js";
import { readCommandLine } from "./command-line.js";
import type { AllowedCommandRecord } from "./shell-records.js";

const folder = "/srv/project";

function allowed(n: number, program: string, args: readonly string[]) {
  const id = idSchema("sac").parse(`sac_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`);
  return { id, text: program, program, args, folder, allowedAtMs: 1 };
}

const list: readonly AllowedCommandRecord[] = [
  allowed(1, "/usr/bin/git", ["status"]),
  allowed(2, "/usr/bin/wc", ["-l"]),
  allowed(3, "/usr/bin/ls", []),
];

// Judges a line in the project folder, each program found in `/usr/bin` unless named missing.
function judge(line: string, missing: readonly string[] = []) {
  const read = readCommandLine(line);
  const words = read.kind === "read" ? read.steps.map((step) => step.words[0] ?? "") : [];
  const programs = words.map((word) => (missing.includes(word) ? undefined : `/usr/bin/${word}`));
  return judgeLine(read, { located: { folder, programs }, dialect: "posix" }, list);
}

describe("judging a command line against the allowed commands", () => {
  it("lists a line only when every step of its chains and pipes is allowed", () => {
    expect(judge("git status").listed).toBe(true);
    expect(judge("git status && ls | wc -l").listed).toBe(true);
    expect(judge("git status; git push").listed).toBe(false);
    expect(judge("ls | wc -c")).toMatchObject({ listed: false, miss: "unlisted" });
  });

  it("binds the arguments word for word and the folder", () => {
    expect(judge("git status --short").listed).toBe(false);
    expect(judge("git 'status'").listed).toBe(true);
    const elsewhere = judgeLine(
      readCommandLine("git status"),
      { located: { folder: "/srv/other", programs: ["/usr/bin/git"] }, dialect: "posix" },
      list,
    );
    expect(elsewhere.listed).toBe(false);
  });

  it("matches the program by its real path, never by its name", () => {
    const local = judgeLine(
      readCommandLine("./git status"),
      { located: { folder, programs: [`${folder}/git`] }, dialect: "posix" },
      list,
    );
    expect(local).toMatchObject({ listed: false, canAlwaysAllow: true });
  });

  it("never lists a line it cannot read, a program not found, or anything on PowerShell", () => {
    expect(judge("git status > out.txt")).toStrictEqual({
      listed: false,
      miss: "unreadable",
      canAlwaysAllow: false,
      steps: [],
    });
    expect(judge("gitx status", ["gitx"])).toMatchObject({ listed: false, miss: "unlisted" });
    const powershell = judgeLine(
      readCommandLine("git status"),
      { located: { folder, programs: ["/usr/bin/git"] }, dialect: "powershell" },
      list,
    );
    expect(powershell).toMatchObject({ listed: false, miss: "powershell", canAlwaysAllow: false });
  });

  it("offers Always allow with each step to keep, unless a step runs other code", () => {
    expect(judge("git log -1 | head -n 3")).toStrictEqual({
      listed: false,
      miss: "unlisted",
      canAlwaysAllow: true,
      steps: [
        { text: "git log -1", program: "/usr/bin/git", args: ["log", "-1"], folder },
        { text: "head -n 3", program: "/usr/bin/head", args: ["-n", "3"], folder },
      ],
    });
    const others = ["bash -c 'ls'", "python3.12 x.py", "ls | xargs rm", "npx thing", "env ls"];
    expect(others.map((line) => judge(line).canAlwaysAllow)).toStrictEqual(others.map(() => false));
  });

  it("knows the programs that run other code by name, wherever they live", () => {
    expect(
      ["/bin/zsh", "/opt/homebrew/bin/node", "C:\\Tools\\PWSH.EXE", "/usr/bin/sudo"].map(
        runsOtherProgram,
      ),
    ).toStrictEqual([true, true, true, true]);
    expect(["/usr/bin/git", "/bin/ls", "/usr/bin/grep"].map(runsOtherProgram)).toStrictEqual([
      false,
      false,
      false,
    ]);
  });
});
