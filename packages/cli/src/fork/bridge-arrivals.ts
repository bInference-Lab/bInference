import { filledAnswer, notFoundAnswer } from "@binference/across/testing";
import { accountRefParts, chainRefSchema } from "@binference/chain";
import type { Fork } from "@binference/chain-evm/fork";
import { baseMainnet, solana } from "@binference/chains";
import { BinferenceError, type Http, type HttpResponse, jsonValueSchema } from "@binference/core";
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";
import { z } from "zod";
import { bridgeContractsOf } from "../compose/bridge-routes.js";
import recordedSolanaFill from "../compose/recorded/solana-usdc-fill.json" with { type: "json" };
import { createRecordedChain, type RecordedChain } from "../compose/test-recorded-chain.js";
import { createSystemHttp } from "../runtime/system-http.js";

/** The owner's address on Solana: the one Relay's recorded fill paid. */
export const solanaPerson = "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT";

/** What Across's SpokePool logged for a deposit on the fork, as `FundsDeposited` names it. */
interface AcrossDeposited {
  readonly hash: Hex;
  readonly inputToken: Hex;
  readonly outputToken: Hex;
  readonly inputAmount: bigint;
  readonly outputAmount: bigint;
  readonly depositId: bigint;
  readonly fillDeadline: number;
  readonly exclusivityDeadline: number;
  readonly depositor: Hex;
  readonly recipient: Hex;
  readonly exclusiveRelayer: Hex;
}

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
const network = createSystemHttp({ version: "test" });
// The relayer of Across's recorded fill on Arbitrum One, and the order Relay's recorded fill on
// Solana named in its memo, which the fills here take for this test's deposits.
const recordedRelayer: Address = "0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0";
const recordedOrder = "0xe74b2e9ec4a759b595bb17cf1211d490a31a0a61788d9710fc5c19de055a5f2e";
// What the recorded fill paid its recipient, and what the recipient held after it.
const recordedPaid = { paid: 3_074_273n, before: 941_564n, after: 4_015_837n };
const relaySolanaChain = 792_703_809;
// The slot of the recorded read of the recipient's balance.
const solanaSlot = 463_721_871;
const baseUsdt = getAddress(
  baseMainnet.tokens.find(({ symbol }) => symbol === "USDT")?.address ?? "",
);
const baseSpoke = bridgeContractsOf("across", "spoke-pool")[chainRefSchema.parse(baseMainnet.id)];
const baseSpokePool = getAddress(baseSpoke === undefined ? "" : accountRefParts(baseSpoke).address);

const fillEvents = parseAbi([
  "event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const filledRelayData = parseAbiParameters(
  "bytes32, bytes32, uint256, uint256, uint256, uint32, uint32, bytes32, bytes32, bytes32, bytes32, (bytes32, bytes32, uint256, uint8)",
);
// Base's blocks the fill reads in: the fill's block, then the finalized and the latest heads.
const blocks = { fill: 0x2_5ff_f00n, final: 0x2_5ff_fe0n, latest: 0x2_600_000n };
const zeroWord = pad("0x0");

const answerOf = (status: number, body: string): HttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body,
});

// Across's fill on Base for the deposit: the relayer's USDT to the recipient, then `FilledRelay`
// naming the deposit's origin, id, depositor, recipient and amounts, as Across's SpokePool logs.
function fillLogs(deposited: AcrossDeposited) {
  const to = getAddress(`0x${deposited.recipient.slice(-40)}`);
  const transfer = {
    address: baseUsdt,
    topics: encodeEventTopics({
      abi: fillEvents,
      eventName: "Transfer",
      args: { from: recordedRelayer, to },
    }),
    data: pad(toHex(deposited.outputAmount)),
  };
  const { depositId, recipient, outputAmount } = deposited;
  const fill = {
    address: baseSpokePool,
    topics: encodeEventTopics({
      abi: fillEvents,
      eventName: "FilledRelay",
      args: { originChainId: 56n, depositId, relayer: pad(recordedRelayer) },
    }),
    data: encodeAbiParameters(filledRelayData, [
      deposited.inputToken,
      deposited.outputToken,
      deposited.inputAmount,
      outputAmount,
      8453n,
      deposited.fillDeadline,
      deposited.exclusivityDeadline,
      deposited.exclusiveRelayer,
      deposited.depositor,
      recipient,
      zeroWord,
      [recipient, zeroWord, outputAmount, 0],
    ]),
  };
  return [transfer, fill];
}

// Base's answers for the fill: its receipt and transaction, and the heads that make it final.
function landBaseFill(base: RecordedChain, deposited: AcrossDeposited): Hex {
  const hash = keccak256(stringToHex(`across fill of ${deposited.hash}`));
  const blockHash = keccak256(stringToHex(`base block of ${hash}`));
  const placed = { blockNumber: toHex(blocks.fill), blockHash, transactionHash: hash };
  const logs = fillLogs(deposited).map((log, index) =>
    Object.assign(log, placed, { transactionIndex: "0x0", logIndex: toHex(index) }),
  );
  const route = { from: recordedRelayer, to: baseSpokePool, transactionIndex: "0x0" };
  const fees = { gasUsed: "0x1a60c", effectiveGasPrice: "0x21a5eda", type: "0x2" };
  base.answer("eth_getTransactionReceipt", [hash], {
    ...placed,
    ...route,
    ...fees,
    status: "0x1",
    logs,
  });
  base.answer("eth_getTransactionByHash", [hash], { ...placed, ...route, hash, value: "0x0" });
  base.answer("eth_blockNumber", [], toHex(blocks.latest));
  const final = { number: toHex(blocks.final), hash: keccak256(stringToHex("base final")) };
  base.answer("eth_getBlockByNumber", ["finalized", false], final);
  return hash;
}

// Across's recorded status of a filled deposit, naming this deposit and its fill.
function acrossStatusOf(deposited: AcrossDeposited, fill: Hex): string {
  const recorded = z.record(z.string(), jsonValueSchema).parse(JSON.parse(filledAnswer));
  return JSON.stringify({
    ...recorded,
    depositId: String(deposited.depositId),
    depositTxHash: deposited.hash,
    depositTxnRef: deposited.hash,
    fillTx: fill,
    fillTxnRef: fill,
  });
}

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
