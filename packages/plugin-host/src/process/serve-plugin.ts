import { BinferenceError, type JsonValue } from "@binference/core";
import type {
  CommunityTools,
  PluginFetchAnswer,
  PluginFetchRequest,
} from "@binference/plugin-sdk/community";
import { channelLines } from "../channel/channel-lines.js";
import {
  type HostMessage,
  hostMessageSchema,
  maxMessageBytes,
  type PluginMessage,
} from "../channel/channel-message.schema.js";
import { failureCodeOf, jsonOutputOf } from "./plugin-module.schema.js";

type CallMessage = Extract<HostMessage, { readonly kind: "call" }>;
type FetchAnswer = Extract<HostMessage, { readonly kind: "fetched" | "fetchRefused" }>;

/** What the plugin's side of the channel runs on. */
export interface PluginSide {
  readonly input: AsyncIterable<Uint8Array>;
  /** Writes one message line. */
  write(line: string): void;
  /** Loads the plugin's entry module and answers its tools. */
  load(entry: string): Promise<CommunityTools>;
}

interface Started {
  readonly tools: CommunityTools;
  readonly config: JsonValue;
  readonly dataFolder: string;
}

function createFetches(send: (message: PluginMessage) => void) {
  const waiting = new Map<string, (answer: FetchAnswer) => void>();
  let count = 0;
  const fetch = async (
    request: PluginFetchRequest,
    signal: AbortSignal,
  ): Promise<PluginFetchAnswer> => {
    count += 1;
    const id = `f${String(count)}`;
    const { url, method = "GET", headers = {}, body } = request;
    const wire = { url, method, headers, ...(body === undefined ? {} : { body }) };
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        waiting.delete(id);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      waiting.set(id, (answer) => {
        signal.removeEventListener("abort", abort);
        waiting.delete(id);
        if (answer.kind === "fetched") {
          resolve({ status: answer.status, headers: answer.headers, body: answer.body });
          return;
        }
        const message = `The plugin host refused the fetch: ${answer.refused}.`;
        reject(new BinferenceError({ code: `plugin.${answer.refused}`, message }));
      });
      send({ kind: "fetch", id, request: wire });
    });
  };
  const answer = (message: FetchAnswer): void => waiting.get(message.id)?.(message);
  return { fetch, answer };
}

async function answerCall(
  started: Started,
  call: CallMessage,
  parts: ReturnType<typeof createFetches> & { readonly send: (message: PluginMessage) => void },
): Promise<void> {
  const run = Object.hasOwn(started.tools, call.tool) ? started.tools[call.tool] : undefined;
  if (run === undefined) {
    parts.send({ kind: "failed", id: call.id, code: "plugin.unknown_tool" });
    return;
  }
  const signal = AbortSignal.timeout(call.timeoutMs);
  const fetch = async (request: PluginFetchRequest) => parts.fetch(request, signal);
  let message: PluginMessage;
  try {
    const output = jsonOutputOf(
      await run(call.input, {
        config: started.config,
        dataFolder: started.dataFolder,
        signal,
        fetch,
      }),
    );
    message =
      output === undefined
        ? { kind: "failed", id: call.id, code: "plugin.bad_output" }
        : { kind: "result", id: call.id, output };
  } catch (error) {
    message = { kind: "failed", id: call.id, code: failureCodeOf(error) };
  }
  const fits = Buffer.byteLength(JSON.stringify(message)) < maxMessageBytes;
  parts.send(fits ? message : { kind: "failed", id: call.id, code: "plugin.output_too_large" });
}

/**
 * Serves the plugin's side of the channel (decision 0300) until its input ends: the first message
 * must be `start`, which loads the entry module and answers `ready` with its tools; each `call`
 * then runs its tool with its own deadline and answers `result` or `failed`, and each fetch a tool
 * asks for goes to the host as `fetch` and waits for its answer. A message it cannot read, or a
 * first one that is not `start`, throws, which ends the process.
 */
export async function servePlugin(side: PluginSide): Promise<void> {
  const send = (message: PluginMessage): void => side.write(`${JSON.stringify(message)}\n`);
  const fetches = createFetches(send);
  let started: Started | undefined;
  for await (const line of channelLines(side.input, maxMessageBytes)) {
    const message = hostMessageSchema.parse(JSON.parse(line));
    if (message.kind === "start" && started === undefined) {
      const { config, dataFolder } = message;
      started = { tools: await side.load(message.entry), config, dataFolder };
      send({ kind: "ready", tools: Object.keys(started.tools) });
    } else if (started === undefined || message.kind === "start") {
      throw new BinferenceError({
        code: "plugin.channel_order",
        message: "The channel's first message must be start, and only the first.",
      });
    } else if (message.kind === "call") {
      void answerCall(started, message, { ...fetches, send });
    } else {
      fetches.answer(message);
    }
  }
}
