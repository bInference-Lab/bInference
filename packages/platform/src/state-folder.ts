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
  /** `auth/`: the client tokens, owner-only. */
  readonly auth: string;
  /**
   * `workspace/`: one folder of workspace files per agent, or the folder `BINFERENCE_WORKSPACE`
   * names, as in the Docker image, where the agent's commands share it (decision 0412).
   */
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
  /** The value of `BINFERENCE_WORKSPACE`; empty or left out means the state folder's `workspace/`. */
  readonly binferenceWorkspace?: string | undefined;
  /** The account's home folder; the OS's own answer when left out. */
  readonly homeDir?: string;
}

// The variables that move a folder, with the fault a relative value gets and its detail's key.
const movers = {
  binferenceHome: { variable: "BINFERENCE_HOME", code: "platform.home_not_absolute" },
  binferenceWorkspace: {
    variable: "BINFERENCE_WORKSPACE",
    code: "platform.workspace_not_absolute",
  },
} as const;

// A folder a variable names must be absolute, since a relative one would move with the working
// folder.
function absoluteFolder(value: string, option: keyof typeof movers): string {
  const { variable, code } = movers[option];
  if (!isAbsolute(value)) {
    throw new BinferenceError({
      code,
      message: `${variable} is ${value}; set it to an absolute path.`,
      details: { [option]: value },
    });
  }
  return resolve(value);
}

/**
 * Resolves every path of the state folder. Creates nothing. Throws `platform.home_not_absolute`
 * when `BINFERENCE_HOME` is a relative path, and `platform.workspace_not_absolute` when
 * `BINFERENCE_WORKSPACE` is, since either would move with the working folder.
 */
export function resolveStateFolder(options: StateFolderOptions = {}): StateFolder {
  const moved = options.binferenceHome ?? "";
  const root =
    moved === ""
      ? join(options.homeDir ?? homedir(), ".binference")
      : absoluteFolder(moved, "binferenceHome");
  const movedWorkspace = options.binferenceWorkspace ?? "";
  const workspace =
    movedWorkspace === ""
      ? join(root, "workspace")
      : absoluteFolder(movedWorkspace, "binferenceWorkspace");
  return {
    root,
    configFile: join(root, "config.json5"),
    engineDatabase: join(root, "engine.sqlite"),
    agentDatabase: join(root, "agent.sqlite"),
    keys: join(root, "keys"),
    auth: join(root, "auth"),
    workspace,
    logs: join(root, "logs"),
    run: join(root, "run"),
    engineLock: join(root, "engine.lock"),
  };
}
