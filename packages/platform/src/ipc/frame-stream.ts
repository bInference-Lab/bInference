import type { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import { BinferenceError } from "@binference/core";
import { createFrameDecoder, encodeFrame } from "./frame-codec.js";

/** Whole frames over a byte stream, read one at a time. */
export interface FrameStream {
  /** Sends one frame; resolves once the stream has taken it. */
  write(payload: Uint8Array, signal: AbortSignal): Promise<void>;
  /** The next frame, in order. Rejects once the stream has closed and every frame was read. */
  read(signal: AbortSignal): Promise<Buffer>;
  /** Ends the stream; later reads and writes reject with `platform.ipc_closed`. */
  close(): void;
}

/** The bounds of a {@link FrameStream}. */
export interface FrameStreamOptions {
  readonly maxFrameBytes: number;
  /**
   * Frames held in each direction. At this count of unread frames the stream pauses until one is
   * read, and a write beyond this count of unfinished writes is refused.
   */
  readonly maxQueuedFrames: number;
}

// Frames that arrived, and the one reader waiting for the next; it knows nothing of the socket.
interface Inbox {
  size(): number;
  failure(): BinferenceError | undefined;
  deliver(frame: Buffer): void;
  /** Records the first failure, rejects a waiting reader with it, and returns it. */
  fail(error: BinferenceError): BinferenceError;
  take(signal: AbortSignal): Promise<Buffer>;
}

interface Reader {
  readonly resolve: (frame: Buffer) => void;
  readonly reject: (reason: Error) => void;
}

function closedError(cause?: Error): BinferenceError {
  return new BinferenceError({
    code: "platform.ipc_closed",
    message: "The IPC connection has closed.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function busyError(direction: "read" | "write"): BinferenceError {
  return new BinferenceError({
    code: `platform.ipc_${direction}_busy`,
    message: `This IPC connection holds no more waiting ${direction}s.`,
  });
}

async function waitForFrame(
  signal: AbortSignal,
  setReader: (reader: Reader | undefined) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      setReader(undefined);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      setReader(undefined);
    };
    setReader({
      resolve: (frame) => {
        finish();
        resolve(frame);
      },
      reject: (reason) => {
        finish();
        reject(reason);
      },
    });
  });
}

function createInbox(): Inbox {
  const queue: Buffer[] = [];
  let reader: Reader | undefined;
  let failure: BinferenceError | undefined;
  return {
    size: () => queue.length,
    failure: () => failure,
    deliver: (frame) => {
      if (reader === undefined) {
        queue.push(frame);
      } else {
        reader.resolve(frame);
      }
    },
    fail: (error) => {
      failure ??= error;
      reader?.reject(failure);
      return failure;
    },
    take: async (signal) => {
      signal.throwIfAborted();
      const frame = queue.shift();
      if (frame !== undefined) {
        return frame;
      }
      if (failure !== undefined) {
        throw failure;
      }
      if (reader !== undefined) {
        throw busyError("read");
      }
      return waitForFrame(signal, (next) => {
        reader = next;
      });
    },
  };
}

async function writeFrame(
  socket: Duplex,
  frame: Buffer,
  context: { readonly writes: Set<(reason: Error) => void>; readonly signal: AbortSignal },
): Promise<void> {
  const { writes, signal } = context;
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      signal.removeEventListener("abort", onAbort);
      writes.delete(reject);
    };
    // A write cut short leaves half a frame on the wire, so the connection ends with it.
    const onAbort = (): void => {
      settle();
      socket.destroy();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    writes.add(reject);
    socket.write(frame, (error) => {
      settle();
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(closedError(error));
      }
    });
  });
}

/**
 * Reads and writes length-prefixed frames on a socket. A frame over the limit, an error or the
 * peer's end closes the stream; frames that arrived before that can still be read.
 */
export function createFrameStream(socket: Duplex, options: FrameStreamOptions): FrameStream {
  const decoder = createFrameDecoder(options.maxFrameBytes);
  const inbox = createInbox();
  // Writes in flight: once the stream fails, the peer may never take them.
  const writes = new Set<(reason: Error) => void>();
  const fail = (error: BinferenceError): void => {
    const failure = inbox.fail(error);
    writes.forEach((reject) => reject(failure));
    writes.clear();
    socket.destroy();
  };
  socket.on("data", (chunk: Buffer) => {
    try {
      decoder.push(chunk).forEach((frame) => inbox.deliver(frame));
    } catch (error) {
      // The decoder throws only its own frame-size fault.
      fail(error instanceof BinferenceError ? error : closedError());
    }
    if (inbox.size() >= options.maxQueuedFrames) {
      socket.pause();
    }
  });
  socket.on("error", (error: Error) => fail(closedError(error)));
  socket.on("end", () => fail(closedError()));
  socket.on("close", () => fail(closedError()));
  return {
    write: async (payload, signal) => {
      signal.throwIfAborted();
      const failure = inbox.failure();
      if (failure !== undefined) {
        throw failure;
      }
      if (writes.size >= options.maxQueuedFrames) {
        throw busyError("write");
      }
      await writeFrame(socket, encodeFrame(payload, options.maxFrameBytes), { writes, signal });
    },
    read: async (signal) => {
      const frame = await inbox.take(signal);
      socket.resume();
      return frame;
    },
    close: () => fail(closedError()),
  };
}
