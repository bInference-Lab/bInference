import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves its relays and RPC on loopback; nothing ships a listener
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type JsonValue } from "@binference/core";
import {
  type Address,
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import { z } from "zod";
import { createSystemHttp } from "../runtime/system-http.js";
import { readChainReply, readChainRequest, signedBytesSchema } from "./crash-chain.schema.js";

/**
 * Where a run kills the engine: after custody signed, before the bytes are stored (`signed`);
 * after they are stored, before a relay has them (`stored`); after a relay passed them to the
 * chain, before the engine heard back (`relayed`); after the engine recorded the send, while the
 * transaction waits for a block (`sent`); after a block took it, before the engine read its
 * receipt (`included`).
 */
export type KillPoint = "signed" | "stored" | "relayed" | "sent" | "included";

/** One send of signed bytes that reached a relay of the test's chain. */
export interface RelayedSend {
  readonly relay: string;
  readonly hash: Hex;
  readonly from: Address;
  readonly nonce: number;
  /** Whether the relay passed the bytes on to the chain. */
  readonly isOnChain: boolean;
}

/** The test's chain as the engine reaches it, which counts what reaches it and kills on cue. */
export interface CrashChain {
  /** The RPC endpoint the engine reads the chain through. */
  readonly rpcUrl: string;
  /** Where its relays listen, each at `/<name>`. */
  readonly relays: string;
  /** Every send the relays received, oldest first. */
  readonly sends: () => readonly RelayedSend[];
  /** Settles once the relays receive the next send from `from`. */
  nextSend(from: Address): Promise<void>;
  /**
   * Runs `kill` once the engine reaches `point` on the chain's side, and answers nothing more of
   * what the killed engine asked; then lets every request through again.
   */
  killAt(point: Exclude<KillPoint, "signed">, kill: () => Promise<void>): void;
  /** Drops a kill the engine never reached, so it cannot fire in a later run. */
  stopKilling(): void;
  /** Calls anvil itself, past the counting and the kills. */
  call(method: string, params: readonly JsonValue[]): Promise<JsonValue>;
  /** Mines 16 blocks every 150 ms, as BSC moves on, until the signal aborts. */
  mine(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

/** A kill the chain waits to run, and how far the engine got towards it. */
interface Armed {
  readonly point: Exclude<KillPoint, "signed">;
  /** Settles once the kill ran: what the killed engine asked meanwhile is never answered. */
  readonly done: Promise<void>;
  /** Whether the engine reached the point, so the kill runs or ran. */
  readonly isTaken: () => boolean;
  /** Takes the kill; answers whether this call took it first. */
  readonly take: () => boolean;
  /** Whether a relay passed the bytes on, so the next receipt read is the engine waiting. */
  readonly hasRelayed: () => boolean;
  readonly markRelayed: () => void;
  /** Runs `before`, then the kill; then every request goes through again. */
  readonly fire: (before?: () => Promise<JsonValue>) => Promise<void>;
}

/** One send of signed bytes as a relay received it. */
interface ReceivedSend {
  readonly relay: string;
  readonly raw: TransactionSerialized;
  readonly isOnChain: boolean;
}

/** What the chain keeps: every send, who waits for the next one, and the kill that waits. */
interface ChainBook {
  readonly sends: () => readonly RelayedSend[];
  readonly note: (send: ReceivedSend) => Promise<void>;
  readonly nextSend: (from: Address) => Promise<void>;
  readonly armed: () => Armed | undefined;
  readonly arm: (point: Armed["point"], kill: () => Promise<void>) => void;
  readonly disarm: () => void;
}

const callTimeoutMs = 30_000;
const boundSchema = z.object({ port: z.int().positive() });

function armedFor(point: Armed["point"], kill: () => Promise<void>, onFired: () => void): Armed {
  const progress = { isTaken: false, hasRelayed: false };
  const finishing = { finish: (): void => undefined };
  const done = new Promise<void>((resolve) => {
    finishing.finish = resolve;
  });
  return {
    point,
    done,
    isTaken: () => progress.isTaken,
    take: () => {
      const isFirst = !progress.isTaken;
      progress.isTaken = true;
      return isFirst;
    },
    hasRelayed: () => progress.hasRelayed,
    markRelayed: () => {
      progress.hasRelayed = true;
    },
    fire: async (before) => {
      await before?.();
      await kill();
      onFired();
      finishing.finish();
    },
  };
}

function createChainBook(): ChainBook {
  const sends: RelayedSend[] = [];
  const waiters = new Set<{ readonly from: Address; readonly resolve: () => void }>();
  const current: { armed?: Armed } = {};
  const disarm = (): void => {
    delete current.armed;
  };
  return {
    sends: () => [...sends],
    note: async ({ relay, raw, isOnChain }) => {
      const from = await recoverTransactionAddress({ serializedTransaction: raw });
      const nonce = parseTransaction(raw).nonce ?? 0;
      sends.push({ relay, hash: keccak256(raw), from, nonce, isOnChain });
      [...waiters]
        .filter((waiter) => waiter.from === from)
        .forEach((waiter) => {
          waiters.delete(waiter);
          waiter.resolve();
        });
    },
    nextSend: async (from) =>
      new Promise((resolve) => {
        waiters.add({ from, resolve });
      }),
    armed: () => current.armed,
    arm: (point, kill) => {
      current.armed = armedFor(point, kill, disarm);
    },
    disarm,
  };
}

// The signed bytes of an `eth_sendRawTransaction`; `undefined` for any other request.
function rawOf(text: string): TransactionSerialized | undefined {
  const request = readChainRequest(text);
  const raw = signedBytesSchema.safeParse(request?.params[0]);
  return request?.method === "eth_sendRawTransaction" && raw.success ? raw.data : undefined;
}

// BSC's nodes answer a send of bytes their pool holds already with geth's "already known", which
// the relay sender reads as taken; anvil words it "transaction already imported". The test's
// relays answer as BSC's do.
function asBscAnswer(request: string, answer: string): string {
  const reply = readChainReply(answer);
  if (!("error" in reply) || !/already imported/i.test(reply.error.message)) {
    return answer;
  }
  const id = readChainRequest(request)?.id ?? null;
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32_000, message: "already known" } });
}

/** What answers each request: anvil's answer, or `undefined` for none, as to a killed engine. */
interface Handlers {
  readonly onRelay: (relay: string, text: string) => Promise<string | undefined>;
  readonly onRpc: (text: string) => Promise<string | undefined>;
}

/** What the handlers reach anvil through. */
interface Upstream {
  readonly forward: (text: string) => Promise<string>;
  readonly call: CrashChain["call"];
}

// The engine reached `stored`, or a kill runs: the bytes are noted and never passed on.
async function holdSend(book: ChainBook, armed: Armed, send: Omit<ReceivedSend, "isOnChain">) {
  const isFirst = armed.take();
  await book.note({ ...send, isOnChain: false });
  await (isFirst ? armed.fire() : armed.done);
  return undefined;
}

// A relay counts every send. At `stored` it passes none on and kills; at `relayed` it passes the
// first on, then kills before it answers; any later send while a kill runs never reaches anvil.
async function sendOf(book: ChainBook, upstream: Upstream, at: { relay: string; text: string }) {
  const raw = rawOf(at.text);
  if (raw === undefined) {
    return upstream.forward(at.text);
  }
  const armed = book.armed();
  if (armed !== undefined && (armed.isTaken() || armed.point === "stored")) {
    return holdSend(book, armed, { relay: at.relay, raw });
  }
  const isRelayedPoint = armed?.point === "relayed";
  if (isRelayedPoint) {
    armed.take();
  }
  const answer = asBscAnswer(at.text, await upstream.forward(at.text));
  await book.note({ relay: at.relay, raw, isOnChain: true });
  if (isRelayedPoint) {
    await armed.fire();
    return undefined;
  }
  armed?.markRelayed();
  return answer;
}

// The RPC kills at `sent` and `included` on the engine's first receipt read once a relay passed
// the bytes on: the engine has recorded the send and waits for a block. At `included` a block
// takes the transaction first.
async function readOf(book: ChainBook, upstream: Upstream, text: string) {
  const armed = book.armed();
  if (armed !== undefined && armed.isTaken()) {
    await armed.done;
    return undefined;
  }
  const isReceiptRead = readChainRequest(text)?.method === "eth_getTransactionReceipt";
  if (armed === undefined || !armed.hasRelayed() || !isReceiptRead) {
    return upstream.forward(text);
  }
  armed.take();
  const mine = async () => upstream.call("evm_mine", []);
  await armed.fire(armed.point === "included" ? mine : undefined);
  return undefined;
}

function handlersOf(book: ChainBook, upstream: Upstream): Handlers {
  return {
    onRelay: async (relay, text) => sendOf(book, upstream, { relay, text }),
    onRpc: async (text) => readOf(book, upstream, text),
  };
}

async function respond(incoming: IncomingMessage, outgoing: ServerResponse, handlers: Handlers) {
  const text = await readBody(incoming);
  const path = incoming.url ?? "/";
  const relay = /^\/([a-z])$/.exec(path)?.[1];
  const rpc = path === "/rpc" ? handlers.onRpc(text) : undefined;
  const answer = await (relay === undefined ? rpc : handlers.onRelay(relay, text));
  if (answer === undefined) {
    outgoing.destroy();
    return;
  }
  outgoing.writeHead(200, { "content-type": "application/json" }).end(answer);
}

function upstreamOf(anvilUrl: string, http: ReturnType<typeof createSystemHttp>): Upstream {
  const forward = async (text: string): Promise<string> => {
    const signal = AbortSignal.timeout(callTimeoutMs);
    const headers = { "content-type": "application/json" };
    const response = await http.request({
      method: "POST",
      url: anvilUrl,
      headers,
      body: text,
      signal,
    });
    return response.body;
  };
  const call: CrashChain["call"] = async (method, params) => {
    const reply = readChainReply(
      await forward(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })),
    );
    if ("error" in reply) {
      throw new BinferenceError({ code: "crash.anvil_refused", message: reply.error.message });
    }
    return reply.result;
  };
  return { forward, call };
}

async function mineUntil(upstream: Upstream, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await upstream.call("anvil_mine", ["0x10"]);
  await wait(150, undefined, { signal }).catch(() => undefined);
  await mineUntil(upstream, signal);
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundSchema.parse(server.address());
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * Serves the test's chain on 127.0.0.1 in front of anvil at `anvilUrl`: an RPC endpoint and
 * relays, each relay a path of one letter, that pass every request on to anvil and note every
 * send of signed bytes with its sender, nonce and hash, and whether anvil got it. That record,
 * with anvil's own, is what a run counts; nothing the engine says about itself counts.
 */
export async function serveCrashChain(anvilUrl: string): Promise<CrashChain> {
  const http = createSystemHttp();
  const upstream = upstreamOf(anvilUrl, http);
  const book = createChainBook();
  const handlers = handlersOf(book, upstream);
  const server = createServer((incoming, outgoing) => {
    respond(incoming, outgoing, handlers).catch(() => outgoing.destroy());
  });
  const origin = await listen(server);
  return {
    rpcUrl: `${origin}/rpc`,
    relays: origin,
    sends: book.sends,
    nextSend: book.nextSend,
    killAt: book.arm,
    stopKilling: book.disarm,
    call: upstream.call,
    mine: async (signal) => mineUntil(upstream, signal),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await http.close();
    },
  };
}
