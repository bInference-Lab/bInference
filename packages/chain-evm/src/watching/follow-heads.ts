import type { Clock } from "@binference/core";
import { readHeadMessage, subscribeRequest } from "./head-message.schema.js";
import type { HeadSocket, HeadSubscription } from "./head-socket.js";
import { repeatSteps } from "./repeat-steps.js";
import { createWakeUp } from "./wake-up.js";

/**
 * Why a subscription to new heads ended: the socket closed or failed, the node refused the
 * subscription, or no head came within the timeout.
 */
export type HeadsEnded = "socket_closed" | "refused" | "head_timeout";

type SocketEvent =
  | { readonly kind: "open" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "closed" };

/** What a subscription runs on and reports to. */
export interface FollowParts {
  readonly subscription: HeadSubscription;
  readonly clock: Clock;
  /**
   * Called with each head's number, in the order the node sent them; answers whether it is above
   * every head seen. Only such a head counts as progress against the subscription's timeout.
   */
  readonly onHead: (number: bigint) => boolean;
}

// A node that floods the socket faster than heads are read loses the oldest messages first.
const maxQueued = 256;

interface Inbox {
  /** The next event, or undefined when none came within the time or a wait woke early. */
  next(timeoutMs: number): Promise<SocketEvent | undefined>;
}

function inboxOf(socket: HeadSocket, clock: Clock, signal: AbortSignal): Inbox {
  const queue: SocketEvent[] = [];
  const arrival = createWakeUp(clock);
  const push = (event: SocketEvent): void => {
    if (queue.length >= maxQueued) {
      queue.shift();
    }
    queue.push(event);
    arrival.wake();
  };
  socket.addEventListener("open", () => push({ kind: "open" }));
  socket.addEventListener("message", ({ data }) =>
    push({ kind: "text", text: typeof data === "string" ? data : "" }),
  );
  socket.addEventListener("close", () => push({ kind: "closed" }));
  socket.addEventListener("error", () => push({ kind: "closed" }));
  return {
    async next(timeoutMs) {
      if (queue.length === 0) {
        await arrival.wait(timeoutMs, signal);
      }
      return queue.shift();
    },
  };
}

/** Where a subscription stands: the id the node gave it, and when the last head came. */
interface Following {
  subscription(): string | undefined;
  subscribed(subscription: string): void;
  sawHead(atMs: number): void;
  lastAtMs(): number;
}

function followingFrom(startMs: number): Following {
  let subscription: string | undefined;
  let lastAtMs = startMs;
  return {
    subscription: () => subscription,
    subscribed: (id) => {
      subscription = id;
    },
    sawHead: (atMs) => {
      lastAtMs = atMs;
    },
    lastAtMs: () => lastAtMs,
  };
}

// One event's effect: undefined goes on reading, anything else ends the subscription.
function onEvent(
  event: SocketEvent,
  state: Following,
  context: { readonly socket: HeadSocket; readonly parts: FollowParts },
): HeadsEnded | undefined {
  if (event.kind === "closed") {
    return "socket_closed";
  }
  if (event.kind === "open") {
    context.socket.send(subscribeRequest);
    return undefined;
  }
  const message = readHeadMessage(event.text);
  if (message?.kind === "refused") {
    return "refused";
  }
  if (message?.kind === "subscribed") {
    state.subscribed(message.subscription);
  } else if (message?.kind === "head" && message.subscription === state.subscription()) {
    onHeadMessage(message.number, state, context.parts);
  }
  return undefined;
}

// A node that repeats a head, or trails the chain, makes no progress: it times out.
function onHeadMessage(number: bigint, state: Following, parts: FollowParts): void {
  if (parts.onHead(number)) {
    state.sawHead(parts.clock.now());
  }
}

// Reads one event; the subscription goes on while this answers undefined.
async function readOne(
  inbox: Inbox,
  state: Following,
  context: { readonly socket: HeadSocket; readonly parts: FollowParts },
): Promise<HeadsEnded | undefined> {
  const { clock, subscription } = context.parts;
  const leftMs = state.lastAtMs() + subscription.headTimeoutMs - clock.now();
  if (leftMs <= 0) {
    return "head_timeout";
  }
  const event = await inbox.next(leftMs);
  return event === undefined ? undefined : onEvent(event, state, context);
}

// A URL the socket refuses, such as one that is not `wss:`, throws as the socket is made.
function openSocket(subscription: HeadSubscription): HeadSocket | undefined {
  try {
    return subscription.open(subscription.url);
  } catch {
    return undefined;
  }
}

/**
 * Follows new block headers over one WebSocket: opens it, subscribes with `eth_subscribe` to
 * `newHeads` and hands each head's number on. It ends when the socket closes or fails, when the
 * node refuses the subscription, and when the socket goes the subscription's timeout without a
 * head above every head seen, subscribing included; the socket is closed whatever ended it. A socket that cannot be
 * opened ends as closed. Rejects with the signal's reason once it aborts.
 */
export async function followHeads(parts: FollowParts, signal: AbortSignal): Promise<HeadsEnded> {
  signal.throwIfAborted();
  const socket = openSocket(parts.subscription);
  if (socket === undefined) {
    return "socket_closed";
  }
  const inbox = inboxOf(socket, parts.clock, signal);
  if (socket.readyState === 1) {
    socket.send(subscribeRequest);
  }
  try {
    const state = followingFrom(parts.clock.now());
    return await repeatSteps(async () => readOne(inbox, state, { socket, parts }));
  } finally {
    socket.close();
  }
}
