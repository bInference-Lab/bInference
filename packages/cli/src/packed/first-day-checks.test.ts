import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  engineParts,
  firstDayPaths,
  guardProblems,
  installProblems,
  leftoversOf,
  pairingCodeOf,
  runSteps,
  sameCodeProblems,
  statusProblems,
  uninstallProblems,
  updateVerdict,
} from "./first-day-checks.js";

const home = join("/scratch", "home");
const paths = firstDayPaths(home, "linux");
const healthy = engineParts.map((signal) => ({ signal, state: "ok" }));

function statusLine(change: Record<string, unknown> = {}): string {
  return JSON.stringify({ state: "ready", version: "2026.11.1", health: healthy, ...change });
}

// A clock that moves 1.5 s at each read, so each step takes 1.5 s.
function steppingClock(): () => number {
  const now = { ms: 0 };
  return () => {
    now.ms += 1500;
    return now.ms;
  };
}

describe("the first-day smoke's checks", () => {
  it("times each step and stops at the first that fails", async () => {
    const ran: string[] = [];
    const step = (name: "init" | "start" | "trade", problems: readonly string[]) => ({
      step: name,
      run: async () => {
        ran.push(name);
        return Promise.resolve(problems);
      },
    });

    const results = await runSteps(
      [step("init", []), step("start", ["start ended with 1"]), step("trade", [])],
      steppingClock(),
    );

    expect(ran).toStrictEqual(["init", "start"]);
    expect(results).toStrictEqual([
      { step: "init", seconds: 1.5, outcome: "passed", problems: [] },
      { step: "start", seconds: 1.5, outcome: "failed", problems: ["start ended with 1"] },
    ]);
  });

  it("records a step that throws as failed with its message", async () => {
    const results = await runSteps(
      [
        {
          step: "trade",
          run: async () => Promise.reject(new Error("No paper fill in Telegram within 120 s.")),
        },
      ],
      steppingClock(),
    );

    expect(results).toMatchObject([
      { outcome: "failed", problems: ["No paper fill in Telegram within 120 s."] },
    ]);
  });

  it("passes a one-liner that installed the launcher and fails one that did not", () => {
    const output = `binference is installed: ${paths.launcher}\n  ${paths.pathText}\n`;

    expect(installProblems({ status: 0, output, command: paths.launcher }, paths)).toStrictEqual(
      [],
    );
    expect(installProblems({ status: 1, output: "npm could not install" }, paths)).toStrictEqual([
      "the one-liner ended with 1",
      `the one-liner named the launcher nowhere, not ${paths.launcher}`,
      "the one-liner printed no PATH line",
    ]);
  });

  it("fails when the sources are not the code the releases were packed from", () => {
    const clean = { commit: "a1b2c3", isChanged: false };
    const launcher = { printed: "binference 2026.11.0\n", version: "2026.11.0" };

    expect(sameCodeProblems("a1b2c3", clean, launcher)).toStrictEqual([]);
    expect(
      sameCodeProblems("d4e5f6", { commit: "a1b2c3", isChanged: true }, launcher),
    ).toStrictEqual([
      "the releases were packed from d4e5f6, the sources are at a1b2c3",
      "the sources hold changes their commit does not",
    ]);
    expect(
      sameCodeProblems("a1b2c3", clean, { printed: "binference 2026.10.4", version: "2026.11.0" }),
    ).toStrictEqual(["the launcher printed binference 2026.10.4, not 2026.11.0"]);
  });

  it("reads the pairing code init printed, and fails an init that did not set up", () => {
    const line = JSON.stringify({ pairing: { link: "https://t.me/bot?start=abc123" } });

    expect(pairingCodeOf(0, line)).toBe("abc123");
    expect(pairingCodeOf(1, line)).toStrictEqual(["init --yes ended with 1"]);
    expect(pairingCodeOf(0, "null")).toStrictEqual(["init --yes printed no pairing link"]);
  });

  it("passes a ready engine with every part and fails a missing or failing part", () => {
    const withoutCustody = healthy.filter((signal) => signal.signal !== "custody");
    const runtimeDown = [
      ...healthy.filter((signal) => signal.signal !== "runtime"),
      { signal: "runtime", state: "fail" },
    ];

    expect(statusProblems(statusLine(), "2026.11.1")).toStrictEqual([]);
    expect(statusProblems(statusLine({ health: withoutCustody }), "2026.11.1")).toStrictEqual([
      "status shows no custody",
    ]);
    expect(statusProblems(statusLine({ health: runtimeDown }), "2026.11.1")).toStrictEqual([
      "runtime fails",
    ]);
    expect(statusProblems(statusLine({ state: "locked" }), "2026.11.2")).toStrictEqual([
      "the engine is locked, not ready",
      "the engine runs 2026.11.1",
    ]);
    expect(statusProblems("null", "2026.11.1")).toStrictEqual([
      "status --json printed no engine status",
    ]);
  });

  it("expects update to pass, and to refuse on Windows", () => {
    const refusal = JSON.stringify({ error: { code: "update.windows" } });

    expect(updateVerdict("linux", 0, "")).toStrictEqual([]);
    expect(updateVerdict("darwin", 1, "")).toStrictEqual(["update ended with 1"]);
    expect(updateVerdict("win32", 1, refusal)).toBe("refused");
    expect(updateVerdict("win32", 0, "")).toStrictEqual([
      "update on Windows ended with 0, not its refusal",
    ]);
  });

  it("fails an uninstall that names no PATH entry to remove", () => {
    const words = `If you added binference's folder to PATH, remove this line:\n  ${paths.pathText}\n`;

    expect(uninstallProblems(0, words, paths)).toStrictEqual([]);
    expect(uninstallProblems(0, "The binference program is removed.", paths)).toStrictEqual([
      "uninstall named no PATH entry to remove",
    ]);
    expect(firstDayPaths(home, "win32").pathText).toBe(
      join(home, "AppData", "Local", "binference", "bin"),
    );
  });

  it("names each part uninstall left behind", async () => {
    const left = new Set([paths.node, paths.data]);
    const checks = { exists: async (path: string) => Promise.resolve(left.has(path)) };

    await expect(leftoversOf(paths, { ...checks, serviceInstalled: false })).resolves.toStrictEqual(
      [`the pinned Node stays at ${paths.node}`, `the data folder stays at ${paths.data}`],
    );
    await expect(
      leftoversOf(paths, { exists: async () => Promise.resolve(false), serviceInstalled: true }),
    ).resolves.toStrictEqual(["the background service is still installed"]);
  });

  it("fails on any call of the OS's own service manager", () => {
    expect(guardProblems("")).toStrictEqual([]);
    expect(guardProblems("launchctl bootstrap gui/501 x.plist\n")).toStrictEqual([
      "the OS's service manager was called: launchctl bootstrap gui/501 x.plist",
    ]);
  });
});
