import { Buffer } from "node:buffer";
import type { ErrorCode } from "@binference/core";
import {
  type CallFrame,
  type ClientFrame,
  decodeClientFrame,
  type FailFrame,
  type OpenFrame,
  type ProveFrame,
  protocolVersion,
  type PushFrame,
  type ReplyFrame,
} from "@binference/protocol";
import type { RawData, WebSocket } from "ws";
import { createCallBudget } from "./call-budget.js";
import type { Session } from "./call-dispatch.js";
import {
  type ConnectionContext,
  type Link,
  type Peer,
  type Phase,
  sayBye,
  sendFrame,
} from "./connection-link.js";
import { keepAlive } from "./keep-alive.js";
import type { Identity } from "./sign-in.js";

/** One served connection. */
export interface Connection {
  /** Says `bye` with the code and closes the socket. */
  end(code: ErrorCode, message: string): void;
  /** Cuts the socket at once, with no `bye`. */
  terminate(): void;
  /** Resolves once the socket closed. */
  readonly closed: Promise<void>;
}

function becomeReady(link: Link, open: OpenFrame, identity: Identity): void {
  const { engine } = link.context;
  const caller = {
    connection: link.id,
    credential: identity.credential,
    client: open.client,
    scopes: identity.scopes,
    transport: link.peer.transport,
  };
  const subscriber = {
    id: link.id,
    scopes: identity.scopes,
    send: (push: PushFrame) => sendFrame(link, push),
  };
  link.phase.set({ name: "ready", session: { caller, subscriber, closed: link.closed.signal } });
  link.signedIn.abort();
  sendFrame(link, {
    t: "ready",
    v: open.v,
    connection: link.id,
    scopes: identity.scopes,
    engine: { version: engine.version, protocol: protocolVersion, state: engine.state() },
    owner: engine.owner(),
  });
  link.context.logger.info("server.ready", { traceId: link.id });
}

async function signIn(link: Link, open: OpenFrame): Promise<void> {
  link.phase.set({ name: "signing_in" });
  const request = { credential: open.auth, transport: link.peer.transport };
  const origin = link.peer.origin === undefined ? {} : { origin: link.peer.origin };
  const step = await link.context.signIn.start({ ...request, ...origin }, link.closed.signal);
  if (link.phase.get().name === "closed") {
    return;
  }
  if (!step.ok) {
    sayBye(link, step.error, "Signing in failed.");
    return;
  }
  if (step.value.kind === "signed_in") {
    becomeReady(link, open, step.value.identity);
    return;
  }
  const { challenge } = step.value;
  link.phase.set({ name: "proving", open, challenge });
  sendFrame(link, { t: "challenge", nonce: challenge.nonce });
}

async function prove(
  link: Link,
  phase: Extract<Phase, { name: "proving" }>,
  frame: ProveFrame,
): Promise<void> {
  link.phase.set({ name: "signing_in" });
  const proved = await phase.challenge.prove(frame.signature, link.closed.signal);
  if (link.phase.get().name === "closed") {
    return;
  }
  if (proved.ok) {
    becomeReady(link, phase.open, proved.value);
    return;
  }
  sayBye(link, proved.error, "The device proof failed.");
}

function call(link: Link, session: Session, frame: CallFrame): void {
  const { limits, dispatch } = link.context;
  if (link.inFlight.has(frame.id)) {
    sayBye(link, "protocol.bad_frame", "A call id is still in use on this connection.");
    return;
  }
  if (!link.budget.take() || link.inFlight.size >= limits.maxCallsInFlight) {
    const error = { code: "protocol.busy", message: "Too many calls.", retryable: true } as const;
    sendFrame(link, { t: "fail", id: frame.id, error });
    return;
  }
  const step = dispatch(frame, session);
  if (step.kind === "answered") {
    step.frames.forEach((answer) => sendFrame(link, answer));
    return;
  }
  link.inFlight.add(frame.id);
  void step.answer.then((answer) => answered(link, answer));
}

function answered(link: Link, answer: ReplyFrame | FailFrame): void {
  link.inFlight.delete(answer.id);
  sendFrame(link, answer);
}

// A failed sign-in step that threw, such as a store fault, ends the connection; the client retries.
function guarded(link: Link, work: Promise<void>): void {
  void work.catch(() => sayBye(link, "internal.error", "Signing in failed on the engine's side."));
}

function route(link: Link, frame: ClientFrame): void {
  const phase = link.phase.get();
  if (phase.name === "ready") {
    if (frame.t === "call") {
      call(link, phase.session, frame);
      return;
    }
    sayBye(link, "protocol.bad_frame", "Only calls follow ready.");
  } else if (phase.name === "opening" && frame.t === "open") {
    guarded(link, signIn(link, frame));
  } else if (phase.name === "proving" && frame.t === "prove") {
    guarded(link, prove(link, phase, frame));
  } else {
    sayBye(link, "protocol.not_open", "The connection is not signed in.");
  }
}

function bytesOf(data: RawData): Buffer {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
}

function tooLarge(link: Link, text: string): void {
  const decoded = link.phase.get().name === "ready" ? decodeClientFrame(text) : undefined;
  if (decoded?.ok === true && decoded.value.t === "call") {
    const error = { code: "protocol.too_large", message: "The frame is too large." } as const;
    sendFrame(link, { t: "fail", id: decoded.value.id, error: { ...error, retryable: false } });
    return;
  }
  sayBye(link, "protocol.too_large", "The frame is too large.");
}

/** One WebSocket message as `ws` hands it over. */
interface Message {
  readonly data: RawData;
  readonly isBinary: boolean;
}

function receive(link: Link, message: Message): void {
  const phase = link.phase.get();
  if (phase.name === "closed") {
    return;
  }
  const { data } = message;
  if (message.isBinary) {
    sayBye(link, "protocol.bad_frame", "Frames are text.");
    return;
  }
  const bytes = bytesOf(data);
  const { limits } = link.context;
  const limit = phase.name === "ready" ? limits.maxFrameBytes : limits.maxSignInFrameBytes;
  if (bytes.byteLength > limit) {
    tooLarge(link, bytes.toString("utf8"));
    return;
  }
  const decoded = decodeClientFrame(bytes.toString("utf8"));
  if (decoded.ok) {
    route(link, decoded.value);
  } else {
    sayBye(link, decoded.error, "The frame could not be read.");
  }
}

function startTimers(link: Link): void {
  const { clock, limits } = link.context;
  keepAlive({
    socket: link.socket,
    clock,
    pingIntervalMs: limits.pingIntervalMs,
    pongTimeoutMs: limits.pongTimeoutMs,
    signal: link.closed.signal,
  });
  const late = (): void => {
    const proving = link.phase.get().name === "proving";
    sayBye(
      link,
      proving ? "auth.expired" : "protocol.not_open",
      "The connection did not sign in within the time allowed.",
    );
  };
  void clock.sleep(limits.signInTimeoutMs, link.signedIn.signal).then(late, () => undefined);
}

function createLink(socket: WebSocket, peer: Peer, context: ConnectionContext): Link {
  let phase: Phase = { name: "opening" };
  const { clock, limits } = context;
  return {
    id: context.ids.next("con"),
    socket,
    peer,
    context,
    phase: {
      get: () => phase,
      set: (next) => {
        phase = next;
      },
    },
    closed: new AbortController(),
    signedIn: new AbortController(),
    inFlight: new Set(),
    budget: createCallBudget({
      clock,
      callsPerSecond: limits.callsPerSecond,
      callBurst: limits.callBurst,
    }),
  };
}

function errorCodeOf(error: Error): string {
  return "code" in error && typeof error.code === "string" ? error.code : "unexpected";
}

/**
 * Serves one WebSocket: the sign-in within `signInTimeoutMs`, then calls and pushes until it
 * closes. The first frame must be `open`; a device answers a `challenge` with `prove`. A WS
 * connection from an origin the server does not allow ends at once with `auth.origin`. Every
 * refusal before `ready` ends the connection with `bye` and its code.
 */
export function serveConnection(
  socket: WebSocket,
  peer: Peer,
  context: ConnectionContext,
): Connection {
  const link = createLink(socket, peer, context);
  const closed = new Promise<void>((resolve) => {
    socket.on("close", () => {
      link.phase.set({ name: "closed" });
      link.closed.abort();
      link.signedIn.abort();
      context.pushes.drop(link.id);
      resolve();
    });
  });
  socket.on("error", (error) => {
    context.logger.warn("server.socket_error", { traceId: link.id, errorCode: errorCodeOf(error) });
  });
  socket.on("message", (data, isBinary) => receive(link, { data, isBinary }));
  startTimers(link);
  if (!peer.isOriginAllowed) {
    sayBye(link, "auth.origin", "This origin may not connect.");
  }
  return {
    end: (code, message) => sayBye(link, code, message),
    terminate: () => socket.terminate(),
    closed,
  };
}
