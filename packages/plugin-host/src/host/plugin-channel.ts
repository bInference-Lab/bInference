import type { Clock, Logger } from "@binference/core";
import { channelLines } from "../channel/channel-lines.js";
import {
  type HostMessage,
  maxMessageBytes,
  type PluginMessage,
} from "../channel/channel-message.schema.js";
import { parsePluginLine } from "../channel/plugin-line.schema.js";
import type { PluginProgram } from "../ports.js";
import type { PluginFetches } from "./plugin-fetches.js";

/**
 * Why a plugin's process ended: it exited, it broke the channel (a message it may not send, or
 * one that does not parse), it stopped reading what the host sent it (`stalled`), it was not
 * `ready` in time, its tools differ from its manifest's, its manifest is not one a community
 * plugin may declare, or the host stopped it.
 */
export type PluginEnd =
  | "exited"
  | "channel_broken"
  | "stalled"
  | "not_ready"
  | "tools_mismatch"
  | "bad_manifest"
  | "stopped";

/** A call's answer from the plugin, or `not_running` when its process ended first. */
export type CallAnswer =
  | Extract<PluginMessage, { readonly kind: "result" | "failed" }>
  | "not_running";

type CallMessage = Extract<HostMessage, { readonly kind: "call" }>;
type LogMessage = Extract<PluginMessage, { readonly kind: "log" }>;

/** The host's side of one plugin's channel. */
export interface PluginChannel {
  /** The tools its first message, `ready`, names; none when it ended before. */
  readonly ready: Promise<readonly string[] | undefined>;
  readonly ended: Promise<PluginEnd>;
  /** Sends a call and settles with its answer. */
  call(message: CallMessage): Promise<CallAnswer>;
  /** The calls sent and not answered. */
  openCalls(): number;
  /** Stops waiting for a call's answer, as when its time ran out; a late answer is dropped. */
  forget(id: string): void;
  send(message: HostMessage): void;
  /** Ends the process at once, if it still runs, and settles every open call. */
  end(reason: PluginEnd): void;
}

/** What one channel needs besides its program. */
export interface ChannelParts {
  readonly plugin: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetches: PluginFetches;
}

const logsPerSecond = 20;
/**
 * The bytes the host may have written to a plugin that the plugin has not read yet (decision
 * 0343). Past them the plugin is `stalled`: it holds the engine's memory instead of its own.
 */
const maxUnreadBytes = 4 * 1_048_576;
const ignore = (): void => undefined;

// A plugin's log lines, at most 20 a second; the rest are dropped.
function createLogLimit(parts: ChannelParts): (message: LogMessage) => void {
  let second = -1;
  let count = 0;
  return (message) => {
    const now = Math.floor(parts.clock.now() / 1_000);
    count = now === second ? count + 1 : 1;
    second = now;
    if (count <= logsPerSecond) {
      parts.logger[message.level]("plugin.log", {
        sourceId: parts.plugin,
        errorCode: message.code,
      });
    }
  };
}

// The channel's life: its `ready` tools, its end, and the calls it still owes an answer.
function createLife(program: PluginProgram) {
  const calls = new Map<string, (answer: CallAnswer) => void>();
  let settleReady: (tools: readonly string[] | undefined) => void = ignore;
  let settleEnded: (end: PluginEnd) => void = ignore;
  const ready = new Promise<readonly string[] | undefined>((resolve) => {
    settleReady = resolve;
  });
  const ended = new Promise<PluginEnd>((resolve) => {
    settleEnded = resolve;
  });
  let over = false;
  const end = (reason: PluginEnd): void => {
    if (!over) {
      over = true;
      program.kill();
      settleReady(undefined);
      [...calls.values()].forEach((settle) => settle("not_running"));
      calls.clear();
      settleEnded(reason);
    }
  };
  const isReady = (tools: readonly string[]): void => settleReady(tools);
  return { calls, ready, ended, end, isReady, isOver: (): boolean => over };
}

async function readLines(
  program: PluginProgram,
  on: {
    readonly receive: (message: PluginMessage) => void;
    readonly end: (reason: PluginEnd) => void;
  },
): Promise<void> {
  let first = true;
  try {
    for await (const line of channelLines(program.output, maxMessageBytes)) {
      const message = parsePluginLine(line);
      if (message === undefined || first !== (message.kind === "ready")) {
        on.end("channel_broken");
        return;
      }
      first = false;
      on.receive(message);
    }
    on.end("exited");
  } catch {
    on.end("channel_broken");
  }
}

// Writes the host's messages, counting the bytes the plugin has not read yet: a message over 1 MiB
// breaks the channel, and more than 4 MiB unread stall it.
function createSender(
  program: PluginProgram,
  end: (reason: PluginEnd) => void,
): (message: HostMessage) => void {
  let unreadBytes = 0;
  return (message) => {
    const line = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(line);
    unreadBytes += bytes;
    if (bytes > maxMessageBytes || unreadBytes > maxUnreadBytes) {
      end(bytes > maxMessageBytes ? "channel_broken" : "stalled");
      return;
    }
    program.write(line).then(
      () => {
        unreadBytes -= bytes;
        return undefined;
      },
      () => end("exited"),
    );
  };
}

/**
 * Opens the host's side of a plugin's channel over its program (decision 0300): each line the
 * plugin writes must parse as a plugin message, the first must be `ready` and only the first; any
 * other ends the process as `channel_broken`, as does a line over 1 MiB. Results go to their
 * calls, fetches to the plugin's fetches, log lines to the logger. Once more than 4 MiB the host
 * wrote wait unread, the process is `stalled`. When the output ends the process has `exited`.
 */
export function openPluginChannel(
  program: PluginProgram,
  parts: ChannelParts,
  signal: AbortSignal,
): PluginChannel {
  const life = createLife(program);
  const send = createSender(program, life.end);
  const log = createLogLimit(parts);
  const receive = (message: PluginMessage): void => {
    if (message.kind === "ready") {
      life.isReady(message.tools);
    } else if (message.kind === "fetch") {
      void parts.fetches.fetch(message.id, message.request, signal).then(send);
    } else if (message.kind === "log") {
      log(message);
    } else {
      life.calls.get(message.id)?.(message);
    }
  };
  void readLines(program, { receive, end: life.end });
  const call = async (message: CallMessage): Promise<CallAnswer> =>
    new Promise((resolve) => {
      if (life.isOver()) {
        resolve("not_running");
        return;
      }
      life.calls.set(message.id, (answer) => {
        life.calls.delete(message.id);
        resolve(answer);
      });
      send(message);
    });
  const { ready, ended, end } = life;
  const forget = (id: string): void => {
    life.calls.delete(id);
  };
  return { ready, ended, call, openCalls: () => life.calls.size, forget, send, end };
}
