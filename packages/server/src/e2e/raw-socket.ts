import { Buffer } from "node:buffer";
import { BinferenceError } from "@binference/core";
import {
  type Credential,
  decodeEngineFrame,
  type EngineFrame,
  type OpenFrame,
} from "@binference/protocol";
import { WebSocket } from "ws";

/** A bare WebSocket to the server that sends any text and reads each frame back. */
export interface RawSocket {
  /** Sends a frame as JSON, or text as it is. */
  send(frame: object | string): void;
  /** Sends bytes as one binary message. */
  sendBinary(bytes: Uint8Array): void;
  /** The next frame the server sent, in order. */
  next(): Promise<EngineFrame>;
  /** Resolves with the close code once the socket closed. */
  readonly closed: Promise<number>;
  close(): void;
}

/** How a raw socket connects. */
export interface RawSocketOptions {
  readonly origin?: string;
  /** Whether the socket answers pings; `true` unless set. */
  readonly answersPings?: boolean;
}

interface Inbox {
  readonly frames: EngineFrame[];
  readonly waiters: ((frame: EngineFrame) => void)[];
}

function deliver(inbox: Inbox, text: string): void {
  const decoded = decodeEngineFrame(text);
  if (!decoded.ok) {
    return;
  }
  const waiter = inbox.waiters.shift();
  if (waiter === undefined) {
    inbox.frames.push(decoded.value);
  } else {
    waiter(decoded.value);
  }
}

/** Opens a raw socket and resolves once it is open. */
export async function openRawSocket(
  url: string,
  options: RawSocketOptions = {},
): Promise<RawSocket> {
  const socket = new WebSocket(url, {
    autoPong: options.answersPings ?? true,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
  const inbox: Inbox = { frames: [], waiters: [] };
  socket.on("message", (data, isBinary) => {
    if (!isBinary) {
      deliver(inbox, Buffer.isBuffer(data) ? data.toString("utf8") : "");
    }
  });
  const closed = new Promise<number>((resolve) => {
    socket.on("close", (code) => resolve(code));
  });
  // A reset after the server cuts the socket is expected; the close code tells the test.
  socket.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return {
    send: (frame) => socket.send(typeof frame === "string" ? frame : JSON.stringify(frame)),
    sendBinary: (bytes) => socket.send(bytes, { binary: true }),
    next: async () => {
      const ready = inbox.frames.shift();
      return ready ?? new Promise((resolve) => inbox.waiters.push(resolve));
    },
    closed,
    close: () => socket.close(),
  };
}

/** The `open` frame of a CLI client with a credential. */
export function openFrame(auth: Credential): OpenFrame {
  return { t: "open", v: 1, client: { kind: "cli", version: "test" }, auth };
}

/** The nonce of a `challenge` frame; throws for any other frame. */
export function challengeNonce(frame: EngineFrame): string {
  if (frame.t !== "challenge") {
    throw new BinferenceError({
      code: "test.no_challenge",
      message: `Got ${frame.t}, not a challenge.`,
    });
  }
  return frame.nonce;
}
