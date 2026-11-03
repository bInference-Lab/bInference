import { join } from "node:path";
import {
  type Clock,
  err,
  type Http,
  type JsonValue,
  type Logger,
  ok,
  type Result,
} from "@binference/core";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import type { PluginStarter } from "../ports.js";
import type { PluginFolders } from "../process/plugin-node-arguments.js";
import {
  type CallAnswer,
  openPluginChannel,
  type PluginChannel,
  type PluginEnd,
} from "./plugin-channel.js";
import { createPluginFetches } from "./plugin-fetches.js";
import { sameTools, type ToolSchemas, toolSchemasOf } from "./tool-schemas.js";

/** One community plugin as the host runs it: what it declares, its folders and its settings. */
export interface PluginSpec {
  readonly manifest: CommunityManifest;
  readonly folders: PluginFolders;
  readonly config: JsonValue;
}

/** Why a tool call has no answer; `tool_failed` carries the plugin's own code in the log only. */
export type CallFailure =
  | "unknown_tool"
  | "bad_input"
  | "busy"
  | "timeout"
  | "bad_output"
  | "tool_failed"
  | "not_running";

/** A plugin whose process is running and ready. */
export interface RunningPlugin {
  /** Calls one of its tools; an answer meets the tool's declared output schema. */
  call(
    tool: string,
    input: JsonValue,
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure>>;
  /** Settles once the process has ended, with why. */
  readonly ended: Promise<PluginEnd>;
  /** Ends the process at once. */
  stop(): void;
}

/** What the host runs a plugin with. */
export interface OpenPluginParts {
  readonly starter: PluginStarter;
  readonly http: Http;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Hears each host the plugin asked for and does not declare. */
  onRefused(host: string): void;
}

/** How long a call has (decision 0300). */
const callTimeoutMs = 30_000;
/** How long a started process has to answer `ready`. */
const readyTimeoutMs = 10_000;
const maxOpenCalls = 16;

function answerOf(
  answer: CallAnswer | "timeout",
  schemas: ToolSchemas,
): Result<JsonValue, CallFailure> {
  if (answer === "timeout" || answer === "not_running") {
    return err(answer);
  }
  if (answer.kind === "failed") {
    return err(answer.code === "plugin.unknown_tool" ? "unknown_tool" : "tool_failed");
  }
  return schemas.output.safeParse(answer.output).success ? ok(answer.output) : err("bad_output");
}

function createCalls(
  channel: PluginChannel,
  schemas: ReadonlyMap<string, ToolSchemas>,
  clock: Clock,
) {
  let count = 0;
  return async (
    tool: string,
    input: JsonValue,
    signal: AbortSignal,
  ): Promise<Result<JsonValue, CallFailure>> => {
    const declared = schemas.get(tool);
    if (declared === undefined) {
      return err("unknown_tool");
    }
    if (!declared.input.safeParse(input).success) {
      return err("bad_input");
    }
    if (channel.openCalls() >= maxOpenCalls) {
      return err("busy");
    }
    count += 1;
    const message = {
      kind: "call",
      id: `c${String(count)}`,
      tool,
      input,
      timeoutMs: callTimeoutMs,
    } as const;
    const stop = new AbortController();
    const late = clock.sleep(callTimeoutMs, AbortSignal.any([signal, stop.signal])).then(
      () => "timeout" as const,
      () => "timeout" as const,
    );
    const answer = await Promise.race([channel.call(message), late]);
    stop.abort();
    if (answer === "timeout") {
      channel.forget(message.id);
    }
    return answerOf(answer, declared);
  };
}

async function readyWithin(channel: PluginChannel, clock: Clock, signal: AbortSignal) {
  const stop = new AbortController();
  const late = clock.sleep(readyTimeoutMs, AbortSignal.any([signal, stop.signal])).then(
    () => undefined,
    () => undefined,
  );
  const tools = await Promise.race([channel.ready, late]);
  stop.abort();
  return tools;
}

/**
 * Starts a community plugin through the starter and opens its channel (decision 0300): it sends
 * `start` with the plugin's entry module, config and declared hosts, and waits 10 seconds for
 * `ready`, whose tools must equal the manifest's, else it ends the process (`not_ready`,
 * `tools_mismatch`). A call checks its input with the tool's declared schema before it is sent,
 * has 30 seconds, and its answer must meet the tool's output schema. Fetches go only to the
 * declared hosts. The signal ends the process.
 */
export async function openPlugin(
  spec: PluginSpec,
  parts: OpenPluginParts,
  signal: AbortSignal,
): Promise<Result<RunningPlugin, PluginEnd>> {
  const { manifest, folders } = spec;
  // The manifest is read again as the host starts the plugin: a stored one may be older than the
  // rules a community plugin's declarations follow now.
  if (!communityManifestSchema.safeParse(manifest).success) {
    return err("bad_manifest");
  }
  const program = await parts.starter.start({ id: manifest.id, folders }, signal);
  const fetches = createPluginFetches({ ...parts, hosts: manifest.hosts });
  const channel = openPluginChannel(program, { ...parts, plugin: manifest.id, fetches }, signal);
  // The supervisor's signal outlives each run, so each run takes its listener off as it ends.
  const stopRun = (): void => channel.end("stopped");
  signal.addEventListener("abort", stopRun, { once: true });
  void channel.ended.then(() => signal.removeEventListener("abort", stopRun));
  const entry = join(folders.packageFolder, manifest.entry);
  const { dataFolder } = folders;
  channel.send({ kind: "start", entry, dataFolder, config: spec.config, hosts: manifest.hosts });
  const tools = await readyWithin(channel, parts.clock, signal);
  if (tools === undefined || !sameTools(manifest, tools)) {
    channel.end(tools === undefined ? "not_ready" : "tools_mismatch");
    return err(await channel.ended);
  }
  return ok({
    call: createCalls(channel, toolSchemasOf(manifest), parts.clock),
    ended: channel.ended,
    stop: () => channel.end("stopped"),
  });
}
