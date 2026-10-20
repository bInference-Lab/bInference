import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves its relays and RPC on loopback; nothing ships a listener
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type JsonValue } from "@binference/core";
import { type Address, type Hex, parseTransaction, type TransactionSerialized } from "viem";
import { z } from "zod";
import { createSystemHttp } from "../runtime/system-http.js";
import {
  type Armed,
  type ChainBook,
  createChainBook,
  type KillOptions,
  type ReceivedSend,
} from "./crash-chain-book.js";
import {
  type ChainRequest,
  readChainReply,
  readChainRequest,
  signedBytesSchema,
} from "./crash-chain.schema.js";
import { multicallAnswer } from "./crash-multicall.js";
import { asBscAnswer, refusalOf } from "./crash-relay-answers.js";

/**
 * Where a run kills the engine: after custody signed, before the bytes are stored (`signed`);
 * after they are stored, before a relay has them (`stored`); after a relay passed them to the
 * chain, before the engine heard back (`relayed`); after the engine recorded the send, while the
 * transaction waits for a block (`sent`); after a block took it, before the engine read its
 * receipt (`included`); once the engine read its receipt, before the block is final (`receipt`),
 * where the kill itself waits for what the engine stores of it.
 */
export type KillPoint = "signed" | "stored" | "relayed" | "sent" | "included" | "receipt";

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
  killAt(
    point: Exclude<KillPoint, "signed">,
    kill: () => Promise<void>,
    options?: KillOptions,
  ): void;
  /**
   * Turns the relays away from every send from now on, as BSC's nodes answer a wallet they read as
   * unable to pay: they note it and never pass it on.
   */
  refuseSends(): void;
  /** Lets the relays pass sends on again. */
  acceptSends(): void;
  /** Drops a kill the engine never reached, so it cannot fire in a later run. */
  stopKilling(): void;
  /**
   * Holds the next RPC read `match` takes: it is never answered. Resolves once it came; a later
   * {@link stopKilling} drops the hold and the read.
   */
  holdNextRead(match: (request: ChainRequest) => boolean): Promise<void>;
  /** Calls anvil itself, past the counting and the kills. */
  call(method: string, params: readonly JsonValue[]): Promise<JsonValue>;
  /** Mines 16 blocks every 150 ms, as BSC moves on, until the signal aborts. */
  mine(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

const callTimeoutMs = 30_000;
const boundSchema = z.object({ port: z.int().positive() });

// The signed bytes of an `eth_sendRawTransaction`; `undefined` for any other request.
function rawOf(text: string): TransactionSerialized | undefined {
  const request = readChainRequest(text);
  const raw = signedBytesSchema.safeParse(request?.params[0]);
  return request?.method === "eth_sendRawTransaction" && raw.success ? raw.data : undefined;
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

// The kill that waits for this send: none for a send below the nonce the kill waits for. A kill
// that waits for a later step's send keeps that send out of any block until it fires.
async function armedFor(book: ChainBook, raw: TransactionSerialized): Promise<Armed | undefined> {
  const armed = armedAt(book, raw);
  if (armed !== undefined && armed.fromNonce > 0) {
    await book.mining.pause();
  }
  return armed;
}

function armedAt(book: ChainBook, raw: TransactionSerialized): Armed | undefined {
  const armed = book.armed();
  const nonce = parseTransaction(raw).nonce ?? 0;
  return armed !== undefined && !armed.isTaken() && nonce < armed.fromNonce ? undefined : armed;
}

// A relay counts every send. At `stored` it passes none on and kills; at `relayed` it passes the
// first on, then kills before it answers; any later send while a kill runs never reaches anvil.
// While the relays refuse, each send is noted and turned away.
async function sendOf(book: ChainBook, upstream: Upstream, at: { relay: string; text: string }) {
  const raw = rawOf(at.text);
  if (raw === undefined) {
    return upstream.forward(at.text);
  }
  if (book.isRefusing()) {
    await book.note({ relay: at.relay, raw, isOnChain: false });
    return refusalOf(at.text);
  }
  const armed = await armedFor(book, raw);
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

// The kill the engine's read reaches: the first receipt read once a relay passed the bytes on,
// while the engine has recorded the send and waits for a block; `undefined` for any other read.
function killReachedBy(book: ChainBook, request: ChainRequest | undefined): Armed | undefined {
  const armed = book.armed();
  const isReceiptRead = request?.method === "eth_getTransactionReceipt";
  return armed !== undefined && !armed.isTaken() && armed.hasRelayed() && isReceiptRead
    ? armed
    : undefined;
}

// The RPC kills at `sent` and `included` on that read. At `included` a block takes the
// transaction first. At `receipt` a block takes it and the engine reads its receipt, then every
// read goes through while the kill waits. A read while any other kill runs, and a held read, are
// never answered.
async function readOf(book: ChainBook, upstream: Upstream, text: string) {
  const request = readChainRequest(text);
  if (request !== undefined && (await book.isReadHeld(request))) {
    return undefined;
  }
  const running = book.armed();
  if (running !== undefined && running.isTaken() && running.point !== "receipt") {
    await running.done;
    return undefined;
  }
  const armed = killReachedBy(book, request);
  if (armed === undefined) {
    return (await multicallAnswer(text, upstream.call)) ?? upstream.forward(text);
  }
  armed.take();
  const mine = async () => upstream.call("evm_mine", []);
  if (armed.point === "receipt") {
    await mine();
    armed.fire().catch(() => undefined);
    return upstream.forward(text);
  }
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

async function mineUntil(book: ChainBook, upstream: Upstream, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await book.mining.round(async () => upstream.call("anvil_mine", ["0x10"]));
  await wait(150, undefined, { signal }).catch(() => undefined);
  await mineUntil(book, upstream, signal);
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
  const http = createSystemHttp({ version: "crash" });
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
    holdNextRead: book.holdRead,
    refuseSends: book.refuse,
    acceptSends: book.accept,
    call: upstream.call,
    mine: async (signal) => mineUntil(book, upstream, signal),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await http.close();
    },
  };
}
