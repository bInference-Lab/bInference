import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves its services on loopback; nothing ships a listener
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import type { HttpMethod, HttpResponse, JsonValue } from "@binference/core";
import type { FakePrivy } from "@binference/custody-privy/testing";
import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  pad,
  parseAbi,
  parseAbiParameters,
  toHex,
  zeroAddress,
} from "viem";
import { z } from "zod";
import { type CrashFlapApi, createCrashFlapApi } from "./crash-flap-api.js";
import { crashExecutor, crashRouter, usdtPerWei } from "./crash-market.js";
import { type CrashTelegram, createCrashTelegram } from "./crash-telegram.js";

/** Privy, KyberSwap's, Flap's and Telegram's APIs as the crash engines reach them, on loopback. */
export interface CrashServices {
  /** Where they listen: `/privy`, `/kyberswap`, `/flap` and `/telegram`. */
  readonly origin: string;
  /** Flap's upload and pin status API, which a run's launch reaches. */
  readonly flap: CrashFlapApi;
  /** Telegram's Bot API, the served install's synthetic one, at `/telegram`. */
  readonly telegram: CrashTelegram;
  /**
   * Makes the fake Privy app the services answer for from now on. Each run's install has an app of
   * its own, as each owner does: an app holds the aggregations of one install's ceiling.
   */
  readonly serve: (privy: FakePrivy) => void;
  /** How many transactions the fake Privy apps have signed. */
  readonly signatures: () => number;
  /**
   * Arms a hold: the next transaction Privy signs is counted, and its answer never sent, as custody
   * that signed and then held until the engine was killed. Resolves once it signed.
   */
  readonly holdNextSignature: () => Promise<void>;
  /**
   * Arms a hold before signing: the next signing request reaches Privy's door and is never
   * signed nor answered, as custody that hung until the engine was killed. Resolves once it came.
   */
  readonly holdNextRequest: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const privyOrigin = "https://api.privy.io";
const routerAbi = parseAbi([
  "struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }",
  "function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)",
]);
const envelope = parseAbiParameters("uint256, bytes, bytes");
const summarySchema = z.looseObject({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  amountOut: z.string(),
});
const buildSchema = z.looseObject({
  routeSummary: summarySchema,
  recipient: z.string(),
  deadline: z.int(),
  slippageTolerance: z.int(),
});
const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function json(status: number, value: JsonValue): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

// KyberSwap's address for the chain's own coin.
const nativeToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function isNative(token: string | null): boolean {
  return token?.toLowerCase() === nativeToken;
}

// A route through one pool at `usdtPerWei`: a buy gets that many USDT units for each wei, a sale
// a wei for each that many units.
function routeOf(query: URLSearchParams): HttpResponse {
  const amountIn = BigInt(query.get("amountIn") ?? "0");
  const tokenIn = query.get("tokenIn");
  const amountOut = isNative(tokenIn) ? amountIn * usdtPerWei : amountIn / usdtPerWei;
  const routeSummary = {
    tokenIn,
    amountIn: amountIn.toString(),
    amountInUsd: "6",
    tokenOut: query.get("tokenOut"),
    amountOut: amountOut.toString(),
    amountOutUsd: "6",
    route: [[{ pool: zeroAddress, exchange: "pancake", poolType: "uniswap-v2" }]],
  };
  return json(200, { code: 0, data: { routeSummary, routerAddress: crashRouter } });
}

// The executor's data as KyberSwap's API encodes it: the recipient in the payload's first word
// and the deadline in its ninth. Nothing on the crash chain reads it; the venue's decoder does.
function executorData(recipient: Address, deadline: number): Hex {
  const words = Array.from({ length: 9 }, (_, index) => {
    if (index === 0) {
      return pad(recipient, { size: 32 });
    }
    return index === 8 ? pad(toHex(deadline), { size: 32 }) : pad("0x00", { size: 32 });
  });
  return concat([crashExecutor, encodeAbiParameters(envelope, [0n, "0x", concat(words)])]);
}

function buildOf(body: string): HttpResponse {
  const order = buildSchema.parse(JSON.parse(body));
  const { routeSummary: summary, slippageTolerance } = order;
  const recipient = getAddress(order.recipient);
  const amount = BigInt(summary.amountIn);
  const amountOut = BigInt(summary.amountOut);
  const isBuy = isNative(summary.tokenIn);
  // A token input names where its units go, all to the executor, as KyberSwap's API encodes it.
  const desc = {
    srcToken: getAddress(summary.tokenIn),
    dstToken: getAddress(summary.tokenOut),
    srcReceivers: isBuy ? [] : [crashExecutor],
    srcAmounts: isBuy ? [] : [amount],
    feeReceivers: [],
    feeAmounts: [],
    dstReceiver: recipient,
    amount,
    minReturnAmount: (amountOut * BigInt(10_000 - slippageTolerance)) / 10_000n,
    flags: 0n,
    permit: "0x",
  } as const;
  const execution = {
    callTarget: crashExecutor,
    approveTarget: zeroAddress,
    targetData: executorData(recipient, order.deadline),
    desc,
    clientData: "0x",
  } as const;
  const data = encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [execution] });
  const value = isBuy ? amount : 0n;
  const answer = { routerAddress: crashRouter, data, transactionValue: value.toString() };
  return json(200, { code: 0, data: answer });
}

function kyberswapOf(path: string, body: string): HttpResponse {
  const url = new URL(path, "http://kyberswap");
  if (url.pathname.endsWith("/api/v1/routes")) {
    return routeOf(url.searchParams);
  }
  return url.pathname.endsWith("/api/v1/route/build")
    ? buildOf(body)
    : json(404, { code: 4040, message: "not found" });
}

function headersOf(incoming: IncomingMessage): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(incoming.headers).flatMap(([name, value]) =>
      typeof value === "string" ? [[name, value]] : [],
    ),
  );
}

function isSigningRequest(path: string, body: string): boolean {
  return /^\/v1\/wallets\/[^/]+\/rpc$/.test(path) && body.includes("eth_signTransaction");
}

function isSignature(path: string, body: string, answer: HttpResponse): boolean {
  return isSigningRequest(path, body) && answer.status === 200;
}

async function privyOf(
  privy: FakePrivy,
  incoming: IncomingMessage,
  call: { readonly path: string; readonly body: string },
) {
  const method = methodSchema.parse(incoming.method);
  const request = {
    method: method satisfies HttpMethod,
    url: `${privyOrigin}${call.path}`,
    headers: headersOf(incoming),
    ...(call.body === "" ? {} : { body: call.body }),
    signal: AbortSignal.timeout(30_000),
  };
  return privy.http.request(request);
}

/** Where the services count the signatures Privy made, and hold one when asked. */
interface SignatureBook {
  readonly count: () => number;
  readonly arm: () => Promise<void>;
  readonly armRequest: () => Promise<void>;
  /** Answers whether a signing request is held before Privy signs it, and so never answered. */
  readonly asked: (outgoing: ServerResponse) => boolean;
  /** Counts a signature; answers whether its answer is held, and so never sent. */
  readonly signed: (outgoing: ServerResponse) => boolean;
  /** Ends every held answer's connection. */
  readonly release: () => void;
}

function createSignatureBook(): SignatureBook {
  const state: {
    signatures: number;
    hold: (() => void) | undefined;
    holdRequest: (() => void) | undefined;
  } = { signatures: 0, hold: undefined, holdRequest: undefined };
  const held: ServerResponse[] = [];
  return {
    count: () => state.signatures,
    arm: async () =>
      new Promise<void>((resolve) => {
        state.hold = resolve;
      }),
    armRequest: async () =>
      new Promise<void>((resolve) => {
        state.holdRequest = resolve;
      }),
    asked(outgoing) {
      const { holdRequest } = state;
      if (holdRequest === undefined) {
        return false;
      }
      state.holdRequest = undefined;
      held.push(outgoing);
      holdRequest();
      return true;
    },
    signed(outgoing) {
      state.signatures += 1;
      const { hold } = state;
      if (hold === undefined) {
        return false;
      }
      state.hold = undefined;
      held.push(outgoing);
      hold();
      return true;
    },
    release: () => {
      held.splice(0).forEach((outgoing) => outgoing.destroy());
    },
  };
}

// Answers one request; a signature the book holds is counted and left unanswered.
function responderOf(
  served: () => FakePrivy | undefined,
  book: SignatureBook,
  apis: { readonly flap: CrashFlapApi; readonly telegram: CrashTelegram },
) {
  const { flap, telegram } = apis;
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const body = await readBody(incoming);
    const path = incoming.url ?? "/";
    if (path.startsWith("/telegram/")) {
      await telegram.respond({ incoming, path: path.slice("/telegram".length), body, outgoing });
      return;
    }
    if (path.startsWith("/flap/")) {
      flap.respond({ path: path.slice("/flap".length), method: incoming.method, outgoing });
      return;
    }
    if (path.startsWith("/kyberswap/")) {
      const answer = kyberswapOf(path.slice("/kyberswap".length), body);
      outgoing.writeHead(answer.status, answer.headers).end(answer.body);
      return;
    }
    const privy = served();
    if (privy === undefined) {
      outgoing.writeHead(503).end();
      return;
    }
    const privyPath = path.slice("/privy".length);
    if (isSigningRequest(privyPath, body) && book.asked(outgoing)) {
      return;
    }
    const answer = await privyOf(privy, incoming, { path: privyPath, body });
    if (isSignature(privyPath, body, answer) && book.signed(outgoing)) {
      return;
    }
    outgoing.writeHead(answer.status, answer.headers).end(answer.body);
  };
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * Serves a fake Privy app, a KyberSwap API, Flap's API and Telegram's Bot API on loopback for the
 * crash engines, which reach them through their Http as they would reach the real services. Privy
 * answers 503 until an app is served. The KyberSwap API routes every buy and sale through one
 * pool at {@link usdtPerWei} and encodes the router's plain `swap` for the recipient and deadline
 * asked; the crash chain's router pays it out.
 */
export async function serveCrashServices(): Promise<CrashServices> {
  const book = createSignatureBook();
  const flap = createCrashFlapApi();
  const telegram = createCrashTelegram();
  const app: { privy?: FakePrivy } = {};
  const respond = responderOf(() => app.privy, book, { flap, telegram });
  const server = createServer((incoming, outgoing) => {
    respond(incoming, outgoing).catch(() => {
      outgoing.writeHead(500).end();
    });
  });
  const origin = await listen(server);
  return {
    origin,
    flap,
    telegram,
    serve: (privy) => {
      app.privy = privy;
    },
    signatures: book.count,
    holdNextSignature: book.arm,
    holdNextRequest: book.armRequest,
    async close() {
      book.release();
      flap.release();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
