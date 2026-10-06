import { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import { BinferenceError } from "@binference/core";
import type { z } from "zod";
import { createFrameStream, type FrameStream } from "./frame-stream.js";
import { proveClient, proveServer } from "./ipc-handshake.js";

/** What an IPC channel is made of. */
export interface IpcChannelOptions<In, Out> {
  /** A connection from `IpcEndpoint.bind` or `IpcEndpoint.connect`. */
  readonly socket: Duplex;
  /**
   * At least 32 random bytes both sides hold, handed over outside the connection: on standard
   * input to a child process, or in an owner-only file.
   */
  readonly key: Uint8Array;
  /** `server` for a connection the listener accepted, `client` for one this side opened. */
  readonly role: "client" | "server";
  /** Parses every message that arrives. */
  readonly inbound: z.ZodType<In>;
  /** Encodes every message before it leaves, such as a `bigint` to its decimal string. */
  readonly outbound: z.ZodType<Out>;
  /** Bounds the handshake. */
  readonly signal: AbortSignal;
}

/** An authenticated connection that carries schema-checked JSON messages. */
export interface IpcChannel<In, Out> {
  /** Encodes and sends one message. */
  send(message: Out, signal: AbortSignal): Promise<void>;
  /**
   * The next message. A message that breaks the inbound schema closes the channel and rejects with
   * `platform.ipc_bad_message`; a closed channel rejects with `platform.ipc_closed`.
   */
  receive(signal: AbortSignal): Promise<In>;
  close(): void;
}

const minKeyBytes = 32;
// The protocol's own frame limit; one message never needs more.
const maxMessageBytes = 1024 * 1024;
const maxQueuedMessages = 16;

function decode<In>(frame: Buffer, schema: z.ZodType<In>, stream: FrameStream): In {
  try {
    return schema.parse(JSON.parse(frame.toString("utf8")));
  } catch (error) {
    stream.close();
    throw new BinferenceError({
      code: "platform.ipc_bad_message",
      message: "An IPC message broke its schema, so the channel closed.",
      cause: error,
    });
  }
}

async function authenticate<In, Out>(
  stream: FrameStream,
  options: IpcChannelOptions<In, Out>,
): Promise<void> {
  const prove = options.role === "server" ? proveServer : proveClient;
  try {
    await prove(stream, options.key, options.signal);
  } catch (error) {
    stream.close();
    if (
      options.signal.aborted ||
      (error instanceof BinferenceError && error.code === "platform.ipc_unauthenticated")
    ) {
      throw error;
    }
    throw new BinferenceError({
      code: "platform.ipc_unauthenticated",
      message: "The IPC peer left before it proved it holds the key.",
      cause: error,
    });
  }
}

/**
 * Opens an authenticated channel on a connection. Both sides prove they hold the key before any
 * message moves, so neither the pipe's access list nor the socket path has to be trusted. Messages
 * are JSON in 4-byte length-prefixed frames of at most 1 MiB; at 16 unread messages the channel
 * stops reading until one is received.
 */
export async function openIpcChannel<In, Out>(
  options: IpcChannelOptions<In, Out>,
): Promise<IpcChannel<In, Out>> {
  if (options.key.byteLength < minKeyBytes) {
    throw new BinferenceError({
      code: "platform.ipc_weak_key",
      message: `An IPC key needs at least ${String(minKeyBytes)} random bytes.`,
    });
  }
  const stream = createFrameStream(options.socket, {
    maxFrameBytes: maxMessageBytes,
    maxQueuedFrames: maxQueuedMessages,
  });
  await authenticate(stream, options);
  return {
    send: async (message, signal) => {
      const text = JSON.stringify(options.outbound.encode(message));
      await stream.write(Buffer.from(text, "utf8"), signal);
    },
    receive: async (signal) => decode(await stream.read(signal), options.inbound, stream),
    close: () => stream.close(),
  };
}
