import type { Clock, ErrorCode, IdSource, Logger } from "@binference/core";
import type { EngineFrame, OpenFrame, ProtocolId } from "@binference/protocol";
import { WebSocket } from "ws";
import type { CallBudget } from "./call-budget.js";
import type { CallDispatch, Session } from "./call-dispatch.js";
import type { EngineFacts } from "./engine-facts.js";
import type { Transport } from "./operation-handlers.js";
import type { PushHub } from "./push-hub.js";
import type { ServerLimits } from "./server-limits.js";
import type { Challenge, SignIn } from "./sign-in.js";

/** What every connection of a server shares. */
export interface ConnectionContext {
  readonly dispatch: CallDispatch;
  readonly signIn: SignIn;
  readonly pushes: PushHub;
  readonly engine: EngineFacts;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly limits: ServerLimits;
}

/** Where a connection came from. */
export interface Peer {
  readonly transport: Transport;
  /** The `Origin` header of the upgrade, if any. */
  readonly origin?: string;
  /** Whether the server lets that origin connect over this transport. */
  readonly isOriginAllowed: boolean;
}

/**
 * Where a connection stands: waiting for `open`, checking its credential, waiting for a device's
 * `prove`, signed in, or closed.
 */
export type Phase =
  | { readonly name: "opening" }
  | { readonly name: "signing_in" }
  | { readonly name: "proving"; readonly open: OpenFrame; readonly challenge: Challenge }
  | { readonly name: "ready"; readonly session: Session }
  | { readonly name: "closed" };

/** One connection's socket and state. */
export interface Link {
  readonly id: ProtocolId<"connection">;
  readonly socket: WebSocket;
  readonly peer: Peer;
  readonly context: ConnectionContext;
  readonly phase: { readonly get: () => Phase; readonly set: (next: Phase) => void };
  /** Aborts when the socket closes. */
  readonly closed: AbortController;
  /** Aborts at `ready` or close, which stops the sign-in timer. */
  readonly signedIn: AbortController;
  /** The ids of the calls running, at most `maxCallsInFlight`. */
  readonly inFlight: Set<string>;
  readonly budget: CallBudget;
}

// The WebSocket close code for each kind of bye: 1001 going away, 1009 too big, 1008 policy.
function closeCodeOf(code: ErrorCode): number {
  if (code === "engine.stopping") {
    return 1001;
  }
  return code === "protocol.too_large" ? 1009 : 1008;
}

/**
 * Sends a frame while the socket is open. A client that lets more than `maxBufferedBytes` pile up
 * is cut with 1013, so it reconnects and resumes its topics from their last `seq`.
 */
export function sendFrame(link: Link, frame: EngineFrame): void {
  const { socket, context } = link;
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (socket.bufferedAmount > context.limits.maxBufferedBytes) {
    context.logger.warn("server.slow_client", { traceId: link.id });
    socket.close(1013, "slow client");
    return;
  }
  socket.send(JSON.stringify(frame));
}

/** Sends `bye` with the code and closes the socket; a closed connection ignores every frame after. */
export function sayBye(link: Link, code: ErrorCode, message: string): void {
  if (link.phase.get().name === "closed") {
    return;
  }
  sendFrame(link, { t: "bye", code, message });
  link.phase.set({ name: "closed" });
  link.signedIn.abort();
  link.socket.close(closeCodeOf(code), code);
  link.context.logger.info("server.bye", { traceId: link.id, errorCode: code });
}
