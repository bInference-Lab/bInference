import type { NameResolver } from "@binference/chain";
import type { Clock, IdSource, Logger } from "@binference/core";
import { createFileHandlers, type EngineFiles, type FileHandlers } from "../files/file-handlers.js";
import { createNameHandlers, type NameHandlers } from "../names/name-handlers.js";
import type { CommandRunner } from "./ports.js";
import { createShellHandlers, type ShellHandlers, type ShellSettings } from "./shell-handlers.js";
import { createShellJobs } from "./shell-jobs.js";

/**
 * The agent's shell as the composition root gives it (decision 0378): the runner on this machine,
 * the owner's settings as they are now, and the log its ends go to. Without it the shell is off.
 */
export interface EngineShell {
  readonly runner: CommandRunner;
  readonly settings: () => ShellSettings;
  readonly logger?: Logger;
  /** The agent's files on this machine (decision 0386); without them every file call refuses. */
  readonly files?: EngineFiles;
}

const off: ShellSettings = { run: "off", timeoutSeconds: 0 };

// The shell handlers of an engine, off when it has no shell.
function shellHandlersOf(options: {
  readonly shell?: EngineShell;
  readonly clock: Clock;
  readonly ids: IdSource;
}): ShellHandlers {
  const { shell, clock, ids } = options;
  const jobs = createShellJobs({
    clock,
    ids,
    ...(shell?.logger === undefined ? {} : { logger: shell.logger }),
    mask: shell === undefined ? (text) => text : (text) => shell.runner.mask(text),
  });
  return createShellHandlers({
    ...(shell === undefined ? {} : { runner: shell.runner }),
    settings: shell?.settings ?? (() => off),
    jobs,
    clock,
  });
}

/**
 * The handlers of the agent's lookups of the machine and the chain's names: `shell/run`,
 * `shell/job`, the file operations and `name/resolve`.
 */
export function machineHandlersOf(options: {
  readonly shell?: EngineShell;
  readonly nameResolvers?: readonly NameResolver[];
  readonly clock: Clock;
  readonly ids: IdSource;
}): ShellHandlers & FileHandlers & NameHandlers {
  const { nameResolvers, clock } = options;
  return {
    ...createNameHandlers({ resolvers: nameResolvers ?? [], clock }),
    ...shellHandlersOf(options),
    ...createFileHandlers(options.shell?.files),
  };
}
