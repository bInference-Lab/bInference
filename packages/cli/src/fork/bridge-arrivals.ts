import { notFoundAnswer } from "@binference/across/testing";
import type { Fork } from "@binference/chain-evm/fork";
import { baseMainnet, solana } from "@binference/chains";
import {
  BinferenceError,
  type Http,
  type HttpResponse,
  jsonValueSchema,
  directRoute,
} from "@binference/core";
import { type Address, getAddress, type Hex } from "viem";
import { z } from "zod";
import recordedSolanaFill from "../compose/recorded/solana-usdc-fill.json" with { type: "json" };
import { createRecordedChain, type RecordedChain } from "../compose/test-recorded-chain.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { type AcrossDeposited, acrossStatusOf, landBaseFill } from "./across-base-fills.js";

/** The owner's address on Solana: the one Relay's recorded fill paid. */
export const solanaPerson = "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT";

/** A Relay order on the fork: its deposit, its order id and what its fill pays the recipient. */
interface RelayOrder {
  readonly hash: Hex;
  readonly orderId: Hex;
  readonly paid: bigint;
}

/**
 * What a bridge on the fork reaches: the fork, Across's and Relay's live APIs for their quotes,
 * and, in place of the destinations and the bridges' status endpoints, answers the test lands.
 */
export interface BridgeArrivals {
  readonly http: Http;
  /** Lands Across's fill of the deposit on Base, and Across's status naming it; its hash. */
  acrossFilled(deposited: AcrossDeposited): Hex;
  /** Lands Relay's fill of the order on Solana, and Relay's request naming it; its signature. */
  relayFilled(order: RelayOrder): string;
  /** Answers that the address holds no code on Base, as a person's wallet there. */
  plainOnBase(address: Address): void;
  /**
   * Answers that the address holds no account on Solana, as the recorded read of its balance
   * found: a wallet no transaction has funded yet.
   */
  plainOnSolana(address: string): void;
  /** Each destination call no answer met, oldest first. */
  unanswered(): readonly string[];
}

const acrossStatus = "https://app.across.to/api/deposit/status?";
const relayRequests = "https://api.relay.link/requests/v2?";
const liveApis = new Set(["https://app.across.to", "https://api.relay.link"]);
const network = createSystemHttp({ version: "test", route: directRoute });
// The order Relay's recorded fill on Solana named in its memo, which the fills here take for this
// test's deposits.
const recordedOrder = "0xe74b2e9ec4a759b595bb17cf1211d490a31a0a61788d9710fc5c19de055a5f2e";
// What the recorded fill paid its recipient, and what the recipient held after it.
const recordedPaid = { paid: 3_074_273n, before: 941_564n, after: 4_015_837n };
const relaySolanaChain = 792_703_809;
// The slot of the recorded read of the recipient's balance.
const solanaSlot = 463_721_871;

const answerOf = (status: number, body: string): HttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body,
});

const recordedCallSchema = z.object({
  method: z.string(),
  params: z.array(jsonValueSchema),
  result: jsonValueSchema,
});
const signatureSchema = z.string().min(64);

const solanaCalls = (text: string) =>
  z.object({ answers: z.array(recordedCallSchema) }).parse(JSON.parse(text)).answers;
const isFill = ({ method }: { readonly method: string }): boolean => method === "getTransaction";

// The recording's answers besides the fill: the recipient's holdings and the mint.
const solanaHoldings = solanaCalls(JSON.stringify(recordedSolanaFill)).filter(
  (call) => !isFill(call),
);

// Relay's recorded fill on Solana, its memo naming this order and its transfer paying `order.paid`.
function solanaFillOf(order: RelayOrder) {
  const { paid, before, after } = recordedPaid;
  const text = JSON.stringify(recordedSolanaFill)
    .replaceAll(recordedOrder, order.orderId)
    .replace(`"amount":"${String(paid)}"`, `"amount":"${String(order.paid)}"`)
    .replace(`"amount":"${String(after)}"`, `"amount":"${String(before + order.paid)}"`);
  return solanaCalls(text).find(isFill);
}

function relayRequestOf(order: RelayOrder, signature: string): string {
  const request = {
    id: order.orderId,
    status: "success",
    data: {
      inTxs: [{ chainId: 56, hash: order.hash }],
      outTxs: [{ chainId: relaySolanaChain, hash: signature }],
      refundFailReason: "N/A",
    },
  };
  return JSON.stringify({ requests: [request] });
}

/** Where the bridge network answers each host from. */
interface Answering {
  readonly fork: Fork;
  readonly base: RecordedChain;
  readonly solana: RecordedChain;
  readonly statuses: ReadonlyMap<string, HttpResponse>;
}

const originsOf = (rpcs: readonly { readonly url: string }[]): ReadonlySet<string> =>
  new Set(rpcs.map(({ url }) => new URL(url).origin));
const baseOrigins = originsOf(baseMainnet.rpcs);
const solanaOrigins = originsOf(solana.rpcs);

// A status endpoint's answer before a fill lands: Across has not seen the deposit, and Relay
// holds no request for it.
function statusOf(answering: Answering, url: string): HttpResponse {
  const unseen = url.startsWith(acrossStatus)
    ? answerOf(404, notFoundAnswer)
    : answerOf(200, `{"requests":[]}`);
  return answering.statuses.get(url) ?? unseen;
}

async function routed(answering: Answering, request: Parameters<Http["request"]>[0]) {
  const { url } = request;
  const { origin, host } = new URL(url);
  if (url.startsWith(answering.fork.rpcUrl)) {
    return answering.fork.http.request(request);
  }
  if (baseOrigins.has(origin)) {
    return answering.base.http.request(request);
  }
  if (solanaOrigins.has(origin)) {
    return answering.solana.http.request(request);
  }
  if (url.startsWith(acrossStatus) || url.startsWith(relayRequests)) {
    return Promise.resolve(statusOf(answering, url));
  }
  if (liveApis.has(origin)) {
    return network.request(request);
  }
  throw new BinferenceError({
    code: "fork.call_refused",
    message: `The fork test reaches no ${host}.`,
  });
}

/**
 * The network of a bridge on the fork: the fork's RPC, Across's and Relay's live APIs for their
 * quotes and builds, their status endpoints answering "not seen yet" until a fill lands, and Base
 * and Solana answered from recordings. Any other host is refused.
 */
export function createBridgeArrivals(fork: Fork): BridgeArrivals {
  const base = createRecordedChain();
  const sol = createRecordedChain({ answers: solanaHoldings });
  const statuses = new Map<string, HttpResponse>();
  const answering = { fork, base, solana: sol, statuses };
  return {
    http: { request: async (request) => routed(answering, request) },
    acrossFilled(deposited) {
      const fill = landBaseFill(base, deposited);
      const query = new URLSearchParams({ depositTxnRef: deposited.hash }).toString();
      statuses.set(`${acrossStatus}${query}`, answerOf(200, acrossStatusOf(deposited, fill)));
      return fill;
    },
    relayFilled(order) {
      const fill = solanaFillOf(order);
      const signature = signatureSchema.parse(fill?.params[0]);
      sol.answer("getTransaction", fill?.params ?? [], fill?.result ?? null);
      const query = new URLSearchParams({ hash: order.hash }).toString();
      statuses.set(`${relayRequests}${query}`, answerOf(200, relayRequestOf(order, signature)));
      return signature;
    },
    plainOnBase(address) {
      base.answer("eth_getCode", [getAddress(address), "latest"], "0x");
    },
    plainOnSolana(address) {
      const config = { encoding: "base64", dataSlice: { offset: 0, length: 0 } };
      const none = { context: { slot: solanaSlot, apiVersion: "4.3.2" }, value: null };
      sol.answer("getAccountInfo", [address, config], none);
    },
    unanswered: () => [...base.unanswered(), ...sol.unanswered()],
  };
}
