import { err, ok } from "@binference/core";
import type { CommandEnd, RunningCommand } from "../shell/command-request.js";
import { maskShellOutput } from "../shell/mask-output.js";
import type { CommandRunner } from "../shell/ports.js";

/** What a fake command does: print and end at once, or run until it is stopped or finished. */
export type FakeCommand =
  | { readonly kind: "ends"; readonly output: string; readonly exitCode: number }
  | { readonly kind: "runs"; readonly output: string };

/** A {@link CommandRunner} for tests: commands come from a script, folders from a list. */
export interface FakeCommandRunner extends CommandRunner {
  /** The folders that exist; the first is the home folder. */
  readonly folders: readonly string[];
  /** The commands started so far, in order. */
  readonly started: readonly string[];
  /** Ends every running command of this line, after it prints `output`. */
  finish(command: string, end: { readonly output?: string; readonly exitCode: number }): void;
}

/** What a fake runner is made from. */
export interface FakeRunnerOptions {
  readonly script?: Readonly<Record<string, FakeCommand>>;
  readonly folders?: readonly string[];
  readonly words?: ReadonlySet<string>;
  /** The programs no `PATH` holds; any other bare name is found in `/usr/bin`. */
  readonly missing?: readonly string[];
  readonly dialect?: "posix" | "powershell";
}

/** A running fake command: its line, how it prints, and how it ends. */
interface Run {
  readonly command: string;
  readonly print: (text: string) => void;
  readonly end: (end: CommandEnd) => void;
}

// Where a program is found: a path as it is, from the folder when relative, and a bare name in
// `/usr/bin` unless it is missing.
function programAt(name: string, folder: string, missing: readonly string[]): string | undefined {
  if (name === "") {
    return undefined;
  }
  if (name.includes("/")) {
    return name.startsWith("/") ? name : `${folder}/${name.replace(/^\.\//u, "")}`;
  }
  return missing.includes(name) ? undefined : `/usr/bin/${name}`;
}

/** The fake commands that run until a stop or a finish ends them. */
interface FakeRuns {
  start(command: string, print: (text: string) => void): RunningCommand;
  finish(command: string, end: { readonly output?: string; readonly exitCode: number }): void;
}

function createFakeRuns(): FakeRuns {
  const runs: Run[] = [];
  return {
    start(command, print) {
      const ends: ((end: CommandEnd) => void)[] = [];
      const ended = new Promise<CommandEnd>((resolve) => {
        ends.push(resolve);
      });
      const run: Run = {
        command,
        print,
        end: (done) => {
          ends.forEach((resolve) => {
            resolve(done);
          });
          runs.splice(runs.indexOf(run) >>> 0, 1);
        },
      };
      runs.push(run);
      const stop = (): void => {
        run.end({ signal: "SIGTERM", timedOut: false, stopped: true });
      };
      return { folder: "", ended, stop };
    },
    finish(command, end) {
      for (const run of runs.filter((each) => each.command === command)) {
        run.print(end.output ?? "");
        run.end({ exitCode: end.exitCode, timedOut: false, stopped: false });
      }
    },
  };
}

/**
 * Creates a fake runner. A command the script does not name prints nothing and exits 0. A
 * `runs` command ends when stopped, with the signal `SIGTERM`, or when `finish` ends it. Masking
 * uses `words` as the recovery phrase word list.
 */
export function createFakeCommandRunner(options: FakeRunnerOptions): FakeCommandRunner {
  const folders = options.folders ?? ["/home/owner"];
  const started: string[] = [];
  const runs = createFakeRuns();
  const words = options.words ?? new Set<string>();
  const missing = options.missing ?? [];
  const folderOf = (folder: string | undefined) => {
    const wanted = folder ?? folders[0] ?? "/";
    return folders.includes(wanted) ? wanted : undefined;
  };
  return {
    folders,
    started,
    dialect: options.dialect ?? "posix",
    mask: (text) => maskShellOutput(text, words),
    locate: async (where) => {
      const folder = folderOf(where.folder);
      return Promise.resolve(
        folder === undefined
          ? err("folder_missing")
          : ok({
              folder,
              programs: where.programs.map((name) => programAt(name, folder, missing)),
            }),
      );
    },
    start(request, onOutput) {
      const folder = folderOf(request.folder);
      if (folder === undefined) {
        return err("folder_missing");
      }
      started.push(request.command);
      const command = options.script?.[request.command] ?? {
        kind: "ends",
        output: "",
        exitCode: 0,
      };
      onOutput(command.output);
      if (command.kind === "runs") {
        return ok({ ...runs.start(request.command, onOutput), folder });
      }
      const end: CommandEnd = { exitCode: command.exitCode, timedOut: false, stopped: false };
      return ok({ folder, ended: Promise.resolve(end), stop: () => undefined });
    },
    finish: (command, end) => {
      runs.finish(command, end);
    },
  };
}
