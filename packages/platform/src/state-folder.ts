import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { BinferenceError } from "@binference/core";

/** Where binference keeps its state: `~/.binference` on every OS, or `BINFERENCE_HOME`. */
export interface StateFolder {
  readonly root: string;
  /** `config.json5`. */
  readonly configFile: string;
  /** `engine.sqlite`: intents, confirmations, transactions, orders and the ledger. */
  readonly engineDatabase: string;
  /** `agent.sqlite`: sessions, transcripts and notes. */
  readonly agentDatabase: string;
  /** `keys/`: the agent's signing key, owner-only. */
  readonly keys: string;
  /** `workspace/`: one folder of workspace files per agent. */
  readonly workspace: string;
  readonly logs: string;
  /** `run/`: the IPC sockets and their locks, owner-only. */
  readonly run: string;
  /** `engine.lock`: the engine lock, so one engine runs per state folder. */
  readonly engineLock: string;
}

/** What moves the state folder. The composition root reads the environment and passes it here. */
export interface StateFolderOptions {
  /** The value of `BINFERENCE_HOME`; empty or left out means `~/.binference`. */
  readonly binferenceHome?: string | undefined;
  /** The account's home folder; the OS's own answer when left out. */
  readonly homeDir?: string;
}

/**
 * Resolves every path of the state folder. Creates nothing. Throws `platform.home_not_absolute`
 * when `BINFERENCE_HOME` is a relative path, since it would move with the working folder.
 */
export function resolveStateFolder(options: StateFolderOptions = {}): StateFolder {
  const moved = options.binferenceHome ?? "";
  if (moved !== "" && !isAbsolute(moved)) {
    throw new BinferenceError({
      code: "platform.home_not_absolute",
      message: `BINFERENCE_HOME is ${moved}; set it to an absolute path.`,
      details: { binferenceHome: moved },
    });
  }
  const root = moved === "" ? join(options.homeDir ?? homedir(), ".binference") : resolve(moved);
  return {
    root,
    configFile: join(root, "config.json5"),
    engineDatabase: join(root, "engine.sqlite"),
    agentDatabase: join(root, "agent.sqlite"),
    keys: join(root, "keys"),
    workspace: join(root, "workspace"),
    logs: join(root, "logs"),
    run: join(root, "run"),
    engineLock: join(root, "engine.lock"),
  };
}
