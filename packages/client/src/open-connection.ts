import { BinferenceError, type Clock, createDeadline, type Logger } from "@binference/core";
import {
  type ByeFrame,
  checkProtocolVersion,
  type ClientFrame,
  decodeEngineFrame,
  type EngineFrame,
  type OpenFrame,
  type ReadyFrame,
} from "@binference/protocol";
import { clientError, errorFromBye } from "./client-error.js";
import type {
  ProtocolSocket,
  SocketClose,
  SocketFactory,
  SocketMessage,
} from "./protocol-socket.js";

/**
 * Signs a console device's challenge: the signature over `deviceProofText` of the nonce and the
 * page's origin, in base64url.
 */
export type DeviceProver = (nonce: string, signal: AbortSignal) => Promise<string>;

/** What one connection attempt needs. */
export interface ConnectionOptions {
  readonly openSocket: SocketFactory;
  /** The first frame, with the credential. */
  readonly open: OpenFrame;
  /** Answers a `challenge`; a device credential needs it. */
  readonly proveDevice?: DeviceProver;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long the socket may take to reach `ready`. */
  readonly timeoutMs: number;
  /** Receives every frame after `ready`, except `bye`. */
  readonly onFrame: (frame: EngineFrame) => void;
}

/** A signed-in connection to the engine. */
export interface Connection {
  readonly ready: ReadyFrame;
  /**
   * Resolves once the socket closes, with the reason: the `bye` code the engine sent, or a
   * retryable `client.disconnected`.
   */
  readonly closed: Promise<BinferenceError>;
  /** Sends a frame while the socket is open. A frame sent after a drop is lost. */
  send(frame: ClientFrame): void;
  close(): void;
}

interface Attempt {
  readonly socket: ProtocolSocket;
  readonly options: ConnectionOptions;
  readonly signal: AbortSignal;
}

// The WebSocket standard's number for an open socket, and its close code for a closure on purpose.
const openState = 1;
const normalClosure = 1000;

function sendFrame(socket: ProtocolSocket, frame: ClientFrame): void {
  if (socket.readyState === openState) {
    socket.send(JSON.stringify(frame));
  }
}

function decodeMessage(event: SocketMessage, logger: Logger): EngineFrame | undefined {
  const decoded = typeof event.data === "string" ? decodeEngineFrame(event.data) : undefined;
  if (decoded?.ok === true) {
    return decoded.value;
  }
  logger.warn("client.bad_frame");
  return undefined;
}

function closeReason(bye: ByeFrame | undefined, close: SocketClose): BinferenceError {
  return bye === undefined
    ? clientError({
        code: "client.disconnected",
        message: `The socket to the engine closed with code ${String(close.code)}.`,
        retryable: true,
        details: { closeCode: close.code },
      })
    : errorFromBye(bye);
}

async function answerChallenge(attempt: Attempt, nonce: string): Promise<void> {
  const prove = attempt.options.proveDevice;
  if (prove === undefined) {
    throw clientError({
      code: "client.cannot_prove",
      message: "The engine asked for a device proof, and this client holds no device key.",
    });
  }
  const signature = await prove(nonce, attempt.signal);
  sendFrame(attempt.socket, { t: "prove", signature });
}

function checkVersion(ready: ReadyFrame): BinferenceError | undefined {
  return checkProtocolVersion(ready.v).ok
    ? undefined
    : new BinferenceError({
        code: "protocol.version",
        message: `The engine serves protocol version ${String(ready.v)}, which this client does not speak.`,
        details: { version: ready.v },
      });
}

interface Wire {
  /** Resolves once the socket closes, with the reason. */
  readonly closed: Promise<BinferenceError>;
  /** Sets where every frame but `bye` goes. */
  route(handler: (frame: EngineFrame) => void): void;
}

const ignoreFrame = (): void => undefined;

function listen(socket: ProtocolSocket, options: ConnectionOptions): Wire {
  let bye: ByeFrame | undefined;
  let handler: (frame: EngineFrame) => void = ignoreFrame;
  const closed = new Promise<BinferenceError>((resolve) => {
    socket.addEventListener("close", (event) => resolve(closeReason(bye, event)));
  });
  socket.addEventListener("open", () => sendFrame(socket, options.open));
  socket.addEventListener("message", (event) => {
    const frame = decodeMessage(event, options.logger);
    if (frame?.t === "bye") {
      bye = frame;
    } else if (frame !== undefined) {
      handler(frame);
    }
  });
  return {
    closed,
    route: (next) => {
      handler = next;
    },
  };
}

function handshake(attempt: Attempt): Promise<Connection> {
  const { socket, options } = attempt;
  const wire = listen(socket, options);
  return new Promise((resolve, reject) => {
    // The first settlement wins: a later reject, such as the close that follows a failure, is a
    // no-op.
    const prove = async (nonce: string): Promise<void> => {
      try {
        await answerChallenge(attempt, nonce);
      } catch (error) {
        reject(error);
      }
    };
    void wire.closed.then(reject);
    attempt.signal.addEventListener("abort", () => reject(attempt.signal.reason));
    wire.route((frame) => {
      if (frame.t === "challenge") {
        void prove(frame.nonce);
      } else if (frame.t === "ready") {
        const versionError = checkVersion(frame);
        if (versionError !== undefined) {
          reject(versionError);
          return;
        }
        wire.route(options.onFrame);
        resolve({
          ready: frame,
          closed: wire.closed,
          send: (out) => sendFrame(socket, out),
          close: () => socket.close(normalClosure),
        });
      }
    });
  });
}

/**
 * Opens one socket, sends `open`, answers a `challenge`, and resolves at `ready`. Rejects when the
 * socket closes first, with the `bye` code or a retryable `client.disconnected`; when `ready`
 * names a version this client does not speak; or with `core.timeout` after `timeoutMs`.
 */
export async function openConnection(
  options: ConnectionOptions,
  signal: AbortSignal,
): Promise<Connection> {
  signal.throwIfAborted();
  const socket = options.openSocket();
  const deadline = createDeadline({ clock: options.clock, signal, timeoutMs: options.timeoutMs });
  try {
    return await handshake({ socket, options, signal: deadline.signal });
  } catch (error) {
    socket.close(normalClosure);
    throw error;
  } finally {
    deadline.clear();
  }
}
