import { Buffer } from "node:buffer";
import { connect, type Socket } from "node:net";
import { idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  type ManualClock,
  type MemoryLogger,
} from "@binference/core/testing";
import { type InboxEntry, sha256Hex } from "@binference/engine";
import { createWebhookIntake, type WebhookAlertStore } from "@binference/engine/orders";
import { createMemoryInboxStore, createMemoryWebhookAlertStore } from "@binference/engine/testing";
import type { ServerAddress } from "../bind-listener.js";
import {
  createWebhookListener,
  type WebhookListener,
  type WebhookListenerLimits,
} from "../webhook-listener.js";
import { type LocalAnswer, requestLocal } from "./local-http.js";

const live = { signal: new AbortController().signal };

/** The planted rule's id and secret, and an id no rule has. */
export const ruleId = "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001";
export const unknownRule = "whr_0190f1c2-3a4b-7c5d-8e6f-000000000002";
export const secret = "q3Zr_x9-AbCdEfGhIjKlMnOpQrStUvWxYz012345678";

/** The route's path for a rule id and a secret. */
export const hook = (rule: string, key: string): string => `/hook/${rule}/${key}`;

/** What a test changes about the listener it starts. */
export interface ListenerOptions {
  readonly store?: (store: WebhookAlertStore) => WebhookAlertStore;
  readonly limits?: Partial<WebhookListenerLimits>;
}

/** A listener a test started, and what it reads and sends with. */
export interface StartedListener {
  readonly address: ServerAddress;
  readonly port: number;
  readonly post: (path: string, body?: string | Uint8Array) => Promise<LocalAnswer>;
  readonly alerts: () => Promise<readonly InboxEntry[]>;
  readonly clock: ManualClock;
  readonly logger: MemoryLogger;
  readonly listener: WebhookListener;
}

/**
 * Starts a webhook listener on a free loopback port over the in-memory stores, with one active
 * rule at two alerts a minute, and answers how to post to it and read what it stored. `opened`
 * gets its closer.
 */
export async function startListener(
  opened: (() => Promise<void>)[],
  options: ListenerOptions = {},
): Promise<StartedListener> {
  const inbox = createMemoryInboxStore();
  const memory = createMemoryWebhookAlertStore({ inbox });
  memory.plant({
    id: idSchema("whr").parse(ruleId),
    secretHash: sha256Hex(secret),
    state: "active",
    ratePerMinute: 2,
  });
  const clock = createManualClock(1_760_000_000_000);
  const store = options.store?.(memory) ?? memory;
  const logger = createMemoryLogger({ subsystem: "webhook" });
  const listener = createWebhookListener({
    port: 0,
    intake: createWebhookIntake({ store, clock }),
    clock,
    logger,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const address = await listener.start(live.signal);
  opened.push(async () => listener.close());
  const post = async (path: string, body: string | Uint8Array = '{"id":"tv-1"}') =>
    requestLocal(address.port, { path, method: "POST", body });
  const alerts = async () => inbox.unhandled({ keyPrefix: "wh:", limit: 100 }, live);
  return { address, port: address.port, post, alerts, clock, logger, listener };
}

/** A raw connection to the listener: what it received so far, and when it closed. */
export interface RawConnection {
  readonly socket: Socket;
  readonly received: () => string;
  /** Resolves once what it received holds `text`. */
  readonly next: (text: string) => Promise<void>;
  readonly closed: Promise<void>;
}

/** Opens a TCP connection to `127.0.0.1:<port>` and writes `text` on it, as a sender would. */
export async function openRaw(port: number, text = ""): Promise<RawConnection> {
  const socket = connect({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  const received = (): string => Buffer.concat(chunks).toString("utf8");
  const waits: { readonly awaited: string; readonly resolve: () => void }[] = [];
  socket.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    waits.filter((wait) => received().includes(wait.awaited)).forEach((wait) => wait.resolve());
  });
  const next = async (awaited: string): Promise<void> =>
    received().includes(awaited)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waits.push({ awaited, resolve });
        });
  const closed = new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
  });
  socket.on("error", () => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  if (text !== "") {
    socket.write(text);
  }
  return { socket, received, next, closed };
}

/** The request line and headers of a POST to `path` that declares `length` body bytes. */
export function postHead(path: string, length: number): string {
  return `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${String(length)}\r\n\r\n`;
}
