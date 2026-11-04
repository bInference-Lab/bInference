import { BinferenceError, err, jsonValueSchema, type Logger, ok } from "@binference/core";
import type { EngineHandler, PublishPush } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  type JobFailedPush,
  type ProtocolErrorCode,
  protocolErrorCodes,
  type ProtocolId,
} from "@binference/protocol";
import type { InstallAnswers } from "../plugins/decide-install.js";
import { readPluginSource } from "../plugins/fetch-plugin.js";
import {
  type InstallFailure,
  type InstallParts,
  installPlugin,
} from "../plugins/install-plugin.js";
import type { LockedPlugin } from "../plugins/plugin-lock.js";
import { pluginViewOf, withPlugin } from "../plugins/plugin-records.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import { removePluginPackage } from "../plugins/put-plugin.js";
import type { Closers } from "./closers.js";
import { createSingleJob } from "./single-job.js";

/** What the plugin operations read, write and announce. */
export interface PluginOperationsOptions extends InstallParts {
  readonly runner: PluginRunner;
  /** Removes a plugin's data folder, where the engine made it. */
  removeData(id: string, signal: AbortSignal): Promise<void>;
  /** The runtime's running turns, which a plugin's answer marks. */
  readonly turns: Pick<RunningTurns, "isRuntime" | "runningOf" | "mark">;
  /** The engine's one publish; an install's end goes to the `job` topic. */
  readonly publish: PublishPush;
  readonly closers: Closers;
  readonly logger: Logger;
}

const add = "plugin/add";

function failedPush(job: ProtocolId<"longJob">, failure: InstallFailure): JobFailedPush {
  const { code } = failure;
  if (code === "plugin.review_needed") {
    // Error details hold plain values, so the review travels as its JSON text.
    const details = { review: JSON.stringify(failure.review) };
    const message = "The plugin waits for the owner's review.";
    return { job, op: add, error: { code, message, retryable: false, details } };
  }
  if (code !== "plugin.fetch_failed") {
    const message = "The plugin was not installed.";
    return { job, op: add, error: { code, message, retryable: false } };
  }
  const { reason } = failure;
  const wait = "retryAfterSec" in failure ? { retryAfterSec: failure.retryAfterSec ?? 0 } : {};
  const message = `The plugin was not fetched: ${reason}.`;
  const error = {
    code,
    message,
    retryable: reason !== "not_published",
    details: { reason, ...wait },
  };
  return { job, op: add, error };
}

// One plugin of the lock by its `plg_` id.
async function entryOf(
  options: PluginOperationsOptions,
  plugin: string,
  signal: AbortSignal,
): Promise<LockedPlugin | undefined> {
  const lock = await options.records.read(signal);
  return lock.plugins.find((entry) => entry.plugin === plugin);
}

// The entry turned on or off, as the lock holds it when the change is written.
function switched(entry: LockedPlugin, change: { readonly enabled: boolean }): LockedPlugin {
  const { disabledReason: _was, ...rest } = entry;
  return change.enabled
    ? { ...rest, enabled: true }
    : { ...rest, enabled: false, disabledReason: "owner" };
}

// Turns a plugin on or off in the lock at once, built from the lock the change reads, so an
// install under way is never written over; hands the agent the tools of those on, and answers
// the plugin as the lock holds it once its start settled, turned off again when the host refused.
async function setEnabled(
  options: PluginOperationsOptions,
  change: { readonly plugin: string; readonly enabled: boolean },
  signal: AbortSignal,
): Promise<LockedPlugin | undefined> {
  const entry = await entryOf(options, change.plugin, signal);
  if (entry === undefined) {
    return undefined;
  }
  if (!change.enabled) {
    await options.runner.stop(entry.id);
  }
  const lock = await options.records.change((now) => {
    const current = now.plugins.find(({ plugin }) => plugin === change.plugin);
    return current === undefined ? now : withPlugin(now, switched(current, change));
  }, signal);
  const next = lock.plugins.find(({ plugin }) => plugin === change.plugin);
  if (next !== undefined && change.enabled && !(await options.runner.begin(lock))) {
    await options.runner.run(next);
  }
  await options.runner.offer(lock);
  return entryOf(options, change.plugin, signal);
}

function callHandler(options: PluginOperationsOptions): EngineHandler<"plugin/call"> {
  return async ({ args, caller, signal }) => {
    const entry = await entryOf(options, args.plugin, signal);
    if (entry === undefined) {
      return err("plugin.not_found");
    }
    if (!entry.enabled) {
      return err("plugin.disabled");
    }
    // The answer is a third party's: the agent's running turn holds outside content from now on,
    // whatever the answer is (decision 0349).
    const turn = options.turns.isRuntime(caller.credential)
      ? options.turns.runningOf(args.agent)
      : undefined;
    if (turn !== undefined) {
      options.turns.mark(args.agent, turn.turn);
    }
    const call = { plugin: entry.id, tool: args.tool, input: args.input };
    const answer = await options.runner.call(call, signal);
    if (answer.ok) {
      return ok({ output: answer.value });
    }
    const reason = answer.error === "unknown_plugin" ? "not_running" : answer.error;
    throw new BinferenceError({
      code: "plugin.call_failed",
      message: `The plugin did not answer: ${reason}.`,
      retryable: true,
      details: { reason },
    });
  };
}

// A fault's code as a protocol code the caller has words for: its own when it is one, else
// `fallback`.
function codeOf(code: string | undefined, fallback: ProtocolErrorCode): ProtocolErrorCode {
  return protocolErrorCodes.find((known) => known === code) ?? fallback;
}

const faultCode = (error: Error | undefined): string | undefined =>
  error instanceof BinferenceError ? error.code : undefined;

// Removes the plugin's data folder; a folder that stays keeps the plugin installed and running as
// it was, so `plugin/remove` can be asked again (decision 0351).
async function removeData(
  options: PluginOperationsOptions,
  entry: LockedPlugin,
  signal: AbortSignal,
): Promise<void> {
  try {
    await options.removeData(entry.id, signal);
  } catch (error) {
    if (entry.enabled) {
      await options.runner.run(entry);
    }
    throw new BinferenceError({
      code: codeOf(
        faultCode(error instanceof Error ? error : undefined),
        "plugin.data_not_removed",
      ),
      message: `The data folder of ${entry.id} was not removed; the plugin stays installed.`,
      details: { plugin: entry.id },
      cause: error,
    });
  }
}

function removeHandler(options: PluginOperationsOptions): EngineHandler<"plugin/remove"> {
  return async ({ args, signal }) => {
    const entry = await entryOf(options, args.plugin, signal);
    if (entry === undefined) {
      return err("plugin.not_found");
    }
    await options.runner.stop(entry.id);
    await removeData(options, entry, signal);
    const lock = await options.records.change(
      (now) => ({ plugins: now.plugins.filter(({ id }) => id !== entry.id) }),
      signal,
    );
    await options.runner.offer(lock);
    await removePluginPackage(options.shelf, entry.id, signal);
    return ok({});
  };
}

// Installs one plugin and publishes how it ended; a stop of the engine ends it unannounced.
async function runInstall(
  options: PluginOperationsOptions,
  install: { readonly job: ProtocolId<"longJob">; readonly answers: InstallAnswers },
  stop: AbortSignal,
): Promise<void> {
  const { job } = install;
  try {
    const outcome = await installPlugin(options, install.answers, stop);
    if (stop.aborted) {
      return;
    }
    const data = outcome.ok
      ? jsonValueSchema.parse({ job, op: add, result: pluginViewOf(outcome.value) })
      : jsonValueSchema.parse(failedPush(job, outcome.failure));
    options.publish({ topic: "job", kind: outcome.ok ? "job/done" : "job/failed", data });
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("plugin.install_stopped", { errorCode });
    if (!stop.aborted) {
      // A fault with a plugin code, such as an unreadable lock, keeps it; any other is the install's.
      const code = codeOf(errorCode, "plugin.install_failed");
      const message = "The plugin was not installed.";
      const failed = { job, op: add, error: { code, message, retryable: false } };
      options.publish({ topic: "job", kind: "job/failed", data: jsonValueSchema.parse(failed) });
    }
  }
}

function addHandler(options: PluginOperationsOptions): EngineHandler<"plugin/add"> {
  const installs = createSingleJob({ ...options, name: "plugin installs" });
  return async ({ args }) => {
    const from = readPluginSource(args.source, args.hash);
    if (!from.ok) {
      return err("protocol.bad_args");
    }
    const answers: InstallAnswers = {
      source: args.source,
      from: from.value,
      ...(args.accepted === undefined ? {} : { accepted: args.accepted }),
      ...(args.typedName === undefined ? {} : { typedName: args.typedName }),
    };
    // A second add asking for other work is refused, naming the install under way.
    const key = JSON.stringify(args);
    const other = installs.runningOther(key);
    if (other !== undefined) {
      throw new BinferenceError({
        code: "protocol.busy",
        message: "Another plugin install runs; this one did not start.",
        retryable: true,
        details: { job: other },
      });
    }
    const job = installs.start(
      async (started, stop) => runInstall(options, { job: started, answers }, stop),
      key,
    );
    return ok({ job });
  };
}

/**
 * The plugin operations (protocol spec, section 7.8; decisions 0348 and 0349). `plugin/list`
 * answers the plugin lock's plugins. `plugin/add` reads its source and hash (`protocol.bad_args`
 * otherwise), answers a job at once and installs one plugin at a time: the same call again gets
 * the job under way, another call `protocol.busy` with its id in `details.job`; its end goes to
 * the `job` topic with the plugin, or with a `plugin` code, the review in the details of
 * `plugin.review_needed`. `plugin/enable` and `plugin/disable` turn a plugin on and off at once,
 * its tools joining or leaving the agent's, and answer it as it stands once its start settled;
 * `plugin/remove` stops it, removes its data folder (else `plugin.data_not_removed`, the plugin
 * kept), its lock entry, then its package. `plugin/call` calls an enabled plugin's tool for the agent's runtime, marking
 * its running turn first.
 */
export function createPluginOperations(options: PluginOperationsOptions): EngineHandlerTable {
  const turnOn = async (
    change: { readonly plugin: string; readonly enabled: boolean },
    signal: AbortSignal,
  ) => {
    const entry = await setEnabled(options, change, signal);
    return entry === undefined ? err("plugin.not_found") : ok(pluginViewOf(entry));
  };
  return {
    "plugin/list": async ({ signal }) => {
      const lock = await options.records.read(signal);
      return ok({ items: lock.plugins.map(pluginViewOf) });
    },
    "plugin/add": addHandler(options),
    "plugin/enable": async ({ args, signal }) =>
      turnOn({ plugin: args.plugin, enabled: true }, signal),
    "plugin/disable": async ({ args, signal }) =>
      turnOn({ plugin: args.plugin, enabled: false }, signal),
    "plugin/remove": removeHandler(options),
    "plugin/call": callHandler(options),
  };
}
