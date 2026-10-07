import { BinferenceError } from "@binference/core";
import type { MessageValues } from "@binference/i18n";
import type { Platform } from "@binference/platform";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";
import type { CheckFinding } from "./check-finding.js";
import { configIssueMessages } from "./config-issue-messages.js";
import { connectEngine, type EngineConnection } from "./connect-engine.js";

/** The config as it loads, when it does, and the finding of `config.valid`. */
export interface ConfigCheck {
  readonly config?: BinferenceConfig;
  readonly finding: CheckFinding;
}

/** What the install checks read: the host, this OS's platform and the check's deadline. */
export interface InstallCheck {
  readonly host: CliHost;
  readonly platform: Platform;
  readonly signal: AbortSignal;
}

/**
 * `config.valid`: config.json5 loads in its layers and passes its schema, the way `start` loads
 * it; each issue comes with its fix.
 */
export async function configFinding(options: InstallCheck): Promise<ConfigCheck> {
  const { host, platform, signal } = options;
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env),
    signal,
  });
  if (loaded.ok) {
    return { config: loaded.config, finding: { check: "config.valid", level: "ok" } };
  }
  const { issues } = loaded;
  const finding: CheckFinding = {
    check: "config.valid",
    level: "fail",
    message: { key: "check.configInvalid", values: { file: "config.json5", count: issues.length } },
    more: issues.flatMap((issue) => configIssueMessages(issue)),
    details: {
      issues: issues.map((issue) => ({
        path: issue.path,
        problem: issue.problem.kind,
        fix: issue.fix,
        layer: issue.origin.layer,
      })),
    },
  };
  return { finding };
}

/**
 * `unlock.mode`: in `file` mode the agent key and the Privy app secret sit in owner-only files, so
 * a copy of the disk with that folder lets someone sign inside the ceiling until the owner removes
 * the agent key (spec 5, section 3); the check warns.
 */
export function unlockFinding(config: BinferenceConfig, platform: Platform): CheckFinding {
  const { mode } = config.engine.unlock;
  if (mode !== "file") {
    return { check: "unlock.mode", level: "ok", details: { mode } };
  }
  const folder = platform.stateFolder.keys;
  return {
    check: "unlock.mode",
    level: "warn",
    message: { key: "check.unlockFile", values: { folder } },
    details: { mode },
  };
}

/** A finding of `engine.reachable` that is not fine: its level, its code and its message. */
interface EngineProblem {
  readonly level: "warn" | "fail";
  readonly code: string;
  readonly key: string;
  readonly values: MessageValues;
}

function engineProblem(problem: EngineProblem): CheckFinding {
  const { level, code, key, values } = problem;
  return { check: "engine.reachable", level, message: { key, values }, details: { code } };
}

// Not running is a warning, since a check may run before `start`; a refusal is a problem.
function unreachableFinding(
  connection: Exclude<EngineConnection, { readonly ok: true }>,
): CheckFinding {
  if (connection.reason === "not_running") {
    const values = { folder: connection.folder };
    return engineProblem({
      level: "warn",
      code: "engine.not_running",
      key: "connect.notRunning",
      values,
    });
  }
  if (connection.reason === "no_sign_in") {
    const values = { file: connection.file };
    return engineProblem({
      level: "fail",
      code: "cli.no_sign_in",
      key: "connect.noSignIn",
      values,
    });
  }
  const { code, reason } = connection;
  return engineProblem({ level: "fail", code, key: `connect.${reason}`, values: { code } });
}

// A fault while reaching the engine, such as a state folder whose socket path is too long, which
// `start` refuses the same way.
function faultFinding(error: ErrorOptions["cause"]): CheckFinding {
  const code = error instanceof BinferenceError ? error.code : "unexpected";
  const key = code === "platform.ipc_path_too_long" ? "error.pathTooLong" : "connect.failed";
  return engineProblem({ level: "fail", code, key, values: { code } });
}

async function reachEngine(options: InstallCheck): Promise<CheckFinding> {
  const connection = await connectEngine(options.host, options.signal);
  if (!connection.ok) {
    return unreachableFinding(connection);
  }
  try {
    const status = await connection.client.call("engine/status", {}, { signal: options.signal });
    return status.state === "ready"
      ? { check: "engine.reachable", level: "ok", details: { version: status.version } }
      : engineProblem({
          level: "warn",
          code: "engine.starting",
          key: "health.starting",
          values: {},
        });
  } finally {
    connection.client.close();
  }
}

/**
 * `engine.reachable`: the engine of this state folder answers `engine/status` over IPC with the
 * CLI token and is ready. Not running or still starting is a warning; a running engine that
 * refuses the CLI or does not answer is a problem, and so is a state folder no engine can listen
 * in.
 */
export async function engineFinding(options: InstallCheck): Promise<CheckFinding> {
  try {
    return await reachEngine(options);
  } catch (error) {
    return faultFinding(error);
  }
}
