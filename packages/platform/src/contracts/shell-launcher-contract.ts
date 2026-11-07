import assert from "node:assert/strict";
import { BinferenceError } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ShellLauncher } from "../ports.js";
import type { RunningShell, ShellLaunch } from "../shell-launch.js";

/** Commands in the launcher's own shell, written for the OS under test. */
export interface ShellCommands {
  /** Prints `out` to standard output and `err` to standard error, then exits with 3. */
  readonly printsAndExits: string;
  /** Prints the folder it runs in. */
  readonly printsFolder: string;
  /** Starts a child that runs for a minute, then waits for it. */
  readonly waitsOnChild: string;
}

/** An adapter under test: the launcher, a folder to run in, and its shell's commands. */
export interface ShellLauncherSubject {
  readonly launcher: ShellLauncher;
  /** Moves the launcher's clock on, as a manual clock does. */
  readonly advance: (delayMs: number) => Promise<void>;
  readonly folder: string;
  readonly commands: ShellCommands;
}

/** Makes subjects, and says whether this launcher's wall holds on the OS running the test. */
export interface ShellLauncherHarness {
  create(): Promise<ShellLauncherSubject>;
  /** False for a launcher whose wall answers `none` here. */
  readonly walls: boolean;
}

function launchOf(subject: ShellLauncherSubject, command: string, timeoutMs = 0): ShellLaunch {
  return { command, folder: subject.folder, timeoutMs, env: { PATH: "/usr/bin:/bin" } };
}

function started(subject: ShellLauncherSubject, launch: ShellLaunch) {
  let output = "";
  const running: RunningShell = subject.launcher.start(launch, (text) => {
    output += text;
  });
  return { running, output: () => output };
}

// The checks that a command runs as given.
function runChecks(harness: ShellLauncherHarness): readonly ContractCheck[] {
  return [
    {
      name: "runs a command and hands on its output and exit code",
      run: async () => {
        const subject = await harness.create();
        const { running, output } = started(
          subject,
          launchOf(subject, subject.commands.printsAndExits),
        );
        const end = await running.ended;
        assert.equal(end.exitCode, 3);
        assert.ok(output().includes("out") && output().includes("err"));
        assert.equal(end.timedOut || end.stopped, false);
      },
    },
    {
      name: "runs a command in the folder it is given",
      run: async () => {
        const subject = await harness.create();
        const { running, output } = started(
          subject,
          launchOf(subject, subject.commands.printsFolder),
        );
        await running.ended;
        assert.equal(output().trim(), subject.folder);
      },
    },
  ];
}

// The checks that a command ends with everything it started.
function endChecks(harness: ShellLauncherHarness): readonly ContractCheck[] {
  return [
    {
      name: "ends a command and the child it started at its time limit",
      run: async () => {
        const subject = await harness.create();
        const { running } = started(subject, launchOf(subject, subject.commands.waitsOnChild, 200));
        await subject.advance(200);
        const end = await running.ended;
        assert.equal(end.timedOut, true);
      },
    },
    {
      name: "ends a command and the child it started when stopped",
      run: async () => {
        const subject = await harness.create();
        const { running } = started(subject, launchOf(subject, subject.commands.waitsOnChild));
        running.stop();
        running.stop();
        const end = await running.ended;
        assert.equal(end.stopped, true);
      },
    },
  ];
}

/** The contract every `ShellLauncher` adapter passes. */
export function shellLauncherContract(harness: ShellLauncherHarness): readonly ContractCheck[] {
  if (!harness.walls) {
    return [
      {
        name: "starts nothing where the wall does not hold",
        run: async () => {
          const subject = await harness.create();
          assert.equal(subject.launcher.wall.kind, "none");
          assert.throws(
            () => subject.launcher.start(launchOf(subject, "echo"), () => undefined),
            (error: Error) => error instanceof BinferenceError && error.code === "platform.no_wall",
          );
        },
      },
    ];
  }
  return [...runChecks(harness), ...endChecks(harness)];
}
