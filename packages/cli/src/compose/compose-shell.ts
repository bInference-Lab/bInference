import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { err, ok } from "@binference/core";
import {
  type CommandEnd,
  type CommandRunner,
  type EngineFiles,
  type EngineShell,
  maskShellOutput,
} from "@binference/engine/shell";
import { isFolder, type ShellEnd, type ShellLauncher, walledPaths } from "@binference/platform";
import { english } from "viem/accounts";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { asJson } from "../config/shown-config.js";
import { machineFilesOf } from "./compose-files.js";
import type { Opened, Opening } from "./open-engine-parts.js";

/** What the agent's shell is built from on this machine. */
export interface ShellParts {
  readonly launcher: ShellLauncher;
  /** The environment the engine started with; each command gets it without binference's secrets. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  /** The config as it is now: the shell's settings and the variables its secrets come from. */
  readonly config: () => BinferenceConfig;
}

const recoveryWords: ReadonlySet<string> = new Set(english);

// The variables a secret source of the config names, so no command can read them. A secret source
// is `{ fromEnv: NAME }` wherever it sits, and names hold no quote.
const fromEnv = /"fromEnv":"([^"]+)"/gu;

function secretVariables(config: BinferenceConfig): ReadonlySet<string> {
  const text = JSON.stringify(asJson(config));
  return new Set([...text.matchAll(fromEnv)].flatMap((match) => match.slice(1, 2)));
}

// The engine's environment less every variable binference reads: its own settings and the
// variables its secrets come from.
function commandEnv(parts: ShellParts): Readonly<Record<string, string>> {
  const secrets = secretVariables(parts.config());
  const kept = Object.entries(parts.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].startsWith("BINFERENCE_") && !secrets.has(entry[0]),
  );
  return Object.fromEntries(kept);
}

// The folder a command starts in: the owner's home folder, or an absolute path, or one under home.
function folderOf(requested: string | undefined, home: string): string | undefined {
  const wanted = requested?.trim() ?? "";
  const folder = wanted === "" || wanted === "~" ? home : wanted.replace(/^~\//u, `${home}/`);
  const path = isAbsolute(folder) ? folder : join(home, folder);
  return isFolder(path) ? path : undefined;
}

function commandEndOf(end: ShellEnd): CommandEnd {
  return {
    ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
    ...(end.signal === undefined ? {} : { signal: end.signal }),
    timedOut: end.timedOut,
    stopped: end.stopped,
  };
}

/**
 * The runner of the agent's commands over a launcher: each starts in its folder with the
 * environment less binference's own variables, its output masked before the model reads it.
 */
export function commandRunnerOf(parts: ShellParts): CommandRunner {
  const home = parts.homeDir ?? homedir();
  return {
    start(request, onOutput) {
      if (parts.launcher.wall.kind === "none") {
        return err("no_wall");
      }
      const folder = folderOf(request.folder, home);
      if (folder === undefined) {
        return err("folder_missing");
      }
      const env = commandEnv(parts);
      const { command, timeoutMs } = request;
      const running = parts.launcher.start({ command, folder, timeoutMs, env }, onOutput);
      return ok({
        folder,
        ended: running.ended.then((end) => {
          if (end.failedToStart !== undefined) {
            onOutput(`The shell could not start: ${end.failedToStart}.\n`);
          }
          return commandEndOf(end);
        }),
        stop: () => {
          running.stop();
        },
      });
    },
    mask: (text) => maskShellOutput(text, recoveryWords),
  };
}

/**
 * The agent's shell on this machine (decision 0378): commands in the owner's login shell through
 * the platform's launcher, behind its wall, with the engine's environment less binference's own
 * variables, starting in the owner's home folder, and the settings `shell` holds as each starts;
 * and the agent's files there, with the settings `files` holds at each call (decision 0386).
 */
export function shellOf(opening: Opening, opened: Opened): EngineShell {
  const { host, platform } = opening;
  const config = (): BinferenceConfig => opened.settings.current();
  const runner = commandRunnerOf({
    launcher: platform.shellLauncher(host.clock),
    env: host.env,
    ...(host.homeDir === undefined ? {} : { homeDir: host.homeDir }),
    config,
  });
  return {
    runner,
    settings: () => config().shell,
    logger: opened.log.logger,
    files: agentFilesOf(opening, opened),
  };
}

/**
 * The agent's files on this machine (decision 0386): relative paths in the workspace, the state
 * folder walled off, and the settings `files` holds at each call. The file tools and the images
 * the agent views read through it alike.
 */
export function agentFilesOf(opening: Opening, opened: Opened): EngineFiles {
  const { host, platform } = opening;
  const files = machineFilesOf({
    walled: walledPaths(platform.stateFolder),
    workspace: platform.stateFolder.workspace,
    homeDir: host.homeDir ?? homedir(),
  });
  return { files, settings: () => opened.settings.current().files };
}
