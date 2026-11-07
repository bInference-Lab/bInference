import { err, ok } from "@binference/core";
import type { CommandEnd, RunningCommand } from "../shell/command-request.js";
import { maskShellOutput } from "../shell/mask-output.js";
import type { CommandRunner } from "../shell/ports.js";

/** What a fake command does: print and end at once, or run until it is stopped. */
export type FakeCommand =
  | { readonly kind: "ends"; readonly output: string; readonly exitCode: number }
  | { readonly kind: "runs"; readonly output: string };

/** A {@link CommandRunner} for tests: commands come from a script, folders from a list. */
export interface FakeCommandRunner extends CommandRunner {
  /** The folders that exist; the first is the home folder. */
  readonly folders: readonly string[];
  /** The commands started so far, in order. */
  readonly started: readonly string[];
}

/**
 * Creates a fake runner. A command the script does not name prints nothing and exits 0. A
 * `runs` command ends only when stopped, with the signal `SIGTERM`. Masking uses `words` as the
 * recovery phrase word list.
 */
export function createFakeCommandRunner(options: {
  readonly script?: Readonly<Record<string, FakeCommand>>;
  readonly folders?: readonly string[];
  readonly words?: ReadonlySet<string>;
}): FakeCommandRunner {
  const folders = options.folders ?? ["/home/owner"];
  const started: string[] = [];
  const words = options.words ?? new Set<string>();
  return {
    folders,
    started,
    mask: (text) => maskShellOutput(text, words),
    start(request, onOutput) {
      const folder = request.folder ?? folders[0] ?? "/";
      if (!folders.includes(folder)) {
        return err("folder_missing");
      }
      started.push(request.command);
      const command = options.script?.[request.command] ?? {
        kind: "ends",
        output: "",
        exitCode: 0,
      };
      onOutput(command.output);
      if (command.kind === "ends") {
        const end: CommandEnd = { exitCode: command.exitCode, timedOut: false, stopped: false };
        return ok({ folder, ended: Promise.resolve(end), stop: () => undefined });
      }
      const ends: ((end: CommandEnd) => void)[] = [];
      const running: RunningCommand = {
        folder,
        ended: new Promise<CommandEnd>((resolve) => {
          ends.push(resolve);
        }),
        stop: () => {
          for (const end of ends) {
            end({ signal: "SIGTERM", timedOut: false, stopped: true });
          }
        },
      };
      return ok(running);
    },
  };
}
