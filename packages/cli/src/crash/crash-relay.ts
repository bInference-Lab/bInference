import { baseMainnet } from "@binference/chains";
import type { HttpResponse, JsonValue } from "@binference/core";
import { signedQuoteFor, signedQuoteOutput } from "@binference/relay/testing";
import {
  type Address,
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  stringToHex,
  toEventSelector,
  toFunctionSelector,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { RecordedChain } from "../compose/test-recorded-chain.js";
import { landOnBase } from "../fork/across-base-fills.js";
import { assemble, fail, type Item, op, p, pullFromCaller } from "./crash-assembler.js";
import { contractLogIn, crashHexSchema } from "./crash-contract-log.js";
import { crashContract } from "./crash-market.js";
import type { CrashApi } from "./crash-routes.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

// The key the crash suite's Relay answers sign orders with and its fills on Base come from.
const solverKey: Hex = keccak256(stringToHex("binference crash relay solver"));

/** The address of the crash suite's Relay solver, which the crash engine takes as Relay's. */
export const crashRelaySolver: Address = privateKeyToAccount(solverKey).address;

/** Relay's depository at its BSC address. */
export const crashRelayDepository: Address = crashContract("relay", "depository");

const depositEvents = parseAbi([
  "event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)",
]);
const [relayErc20Deposit] = depositEvents;
const transferEvent = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const depositErc20 = toFunctionSelector("depositErc20(address,address,uint256,bytes32)");
const baseUsdc = getAddress(
  baseMainnet.tokens.find(({ symbol }) => symbol === "USDC")?.address ?? "",
);

// The call data word at `from` to memory at `to`.
const copied = (from: number, to: number): readonly Item[] => [
  p(1, BigInt(from)),
  op.callDataLoad,
  p(1, BigInt(to)),
  op.mstore,
];

/**
 * The runtime code of the crash chain's Relay depository: `depositErc20` takes the amount of the
 * token from the caller through its allowance and logs `RelayErc20Deposit` of the depositor, the
 * token, the amount and the order id, as Relay's depository does; any other call reverts.
 */
const depositoryCode: Hex = assemble([
  p(1, 0n),
  op.callDataLoad,
  p(1, 0xe0n),
  op.shr,
  p(4, BigInt(depositErc20)),
  op.eq,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  ...pullFromCaller([p(1, 0x24n), op.callDataLoad], [p(1, 0x44n), op.callDataLoad]),
  ...copied(0x04, 0x00),
  ...copied(0x24, 0x20),
  ...copied(0x44, 0x40),
  ...copied(0x64, 0x60),
  p(32, BigInt(toEventSelector(relayErc20Deposit))),
  p(1, 0x80n),
  p(1, 0n),
  op.log1,
  op.stop,
  ...fail,
]);

const quoteBodySchema = z.looseObject({ user: z.string(), recipient: z.string() });
const quoteIdSchema = z.looseObject({
  protocol: z.looseObject({ v2: z.looseObject({ orderId: z.string() }) }),
});

const json = (body: string): HttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body,
});

// The order a mined deposit paid, by the depository's own event; none while it is unmined.
async function orderPaidIn(anvil: AnvilCall, hash: Hex): Promise<Hex | undefined> {
  const log = await contractLogIn(anvil, { hash, contract: crashRelayDepository });
  if (log === undefined) {
    return undefined;
  }
  const event = decodeEventLog({
    abi: depositEvents,
    eventName: "RelayErc20Deposit",
    data: log.data,
    topics: [...log.topics],
  });
  return event.args?.id;
}

// Relay's fill on Base of the order: its solver's USDC to the recipient, the recorded output.
function landFill(
  base: RecordedChain,
  fill: { readonly orderId: Hex; readonly recipient: Address },
): Hex {
  const hash = keccak256(stringToHex(`relay fill of ${fill.orderId}`));
  const topics = encodeEventTopics({
    abi: transferEvent,
    eventName: "Transfer",
    args: { from: crashRelaySolver, to: fill.recipient },
  });
  const transfer = { address: baseUsdc, topics, data: pad(toHex(signedQuoteOutput)) };
  landOnBase(base, { hash, from: crashRelaySolver, to: baseUsdc, logs: [transfer] });
  return hash;
}

/** Relay's API as a crash run's bridge reaches it, and the reads a run holds. */
export interface CrashRelay {
  /** Relay's quote and requests, served at `/relay`. */
  readonly api: CrashApi;
  /**
   * Holds the next request status read unanswered, as a follower that asked when the engine was
   * killed; resolves once it came.
   */
  readonly holdNextStatus: () => Promise<void>;
}

/** What the crash suite's Relay answers from: anvil, Base, and each order's recipient. */
interface RelayParts {
  readonly anvil: AnvilCall;
  readonly base: RecordedChain;
  readonly recipients: Map<string, Address>;
}

// Relay's recorded quote made out for the asked wallet and recipient, signed by the crash suite's
// solver, its order's recipient kept for the fill.
async function quoteOf(parts: RelayParts, body: string): Promise<HttpResponse> {
  const asked = quoteBodySchema.parse(JSON.parse(body));
  const deadline = Math.floor(Date.now() / 1_000) + 7 * 86_400;
  const depositor = getAddress(asked.user);
  const recipient = getAddress(asked.recipient);
  const quote = await signedQuoteFor({ depositor, recipient, solverKey, deadline });
  const { orderId } = quoteIdSchema.parse(JSON.parse(quote)).protocol.v2;
  parts.recipients.set(orderId.toLowerCase(), recipient);
  return json(quote);
}

// Relay's requests for a deposit: none while it is unmined, then its order filled on Base.
async function statusOf(parts: RelayParts, hash: Hex): Promise<HttpResponse> {
  const orderId = await orderPaidIn(parts.anvil, hash);
  const recipient = orderId === undefined ? undefined : parts.recipients.get(orderId.toLowerCase());
  if (orderId === undefined || recipient === undefined) {
    return json(`{"requests":[]}`);
  }
  const fill = landFill(parts.base, { orderId, recipient });
  const data = {
    inTxs: [{ chainId: 56, hash }],
    outTxs: [{ chainId: 8453, hash: fill }],
    refundFailReason: "N/A",
  };
  return json(JSON.stringify({ requests: [{ id: orderId, status: "success", data }] }));
}

/**
 * Installs Relay's side of a bridge on the bare crash chain: at its BSC address, the depository
 * above; and serves Relay's API, whose quote is Relay's recorded 20 USDC to Base made out for the
 * run's wallet and recipient and signed by the crash suite's solver, and whose requests answer a
 * mined deposit filled, the fill landed on `base` from that solver.
 */
export async function installCrashRelay(
  anvil: AnvilCall,
  base: RecordedChain,
): Promise<CrashRelay> {
  await anvil("anvil_setCode", [crashRelayDepository, depositoryCode]);
  const parts: RelayParts = { anvil, base, recipients: new Map() };
  const holds: { next?: () => void } = {};
  return {
    api: async ({ path, body }) => {
      const url = new URL(path, "https://api.relay.link");
      if (url.pathname.endsWith("/quote/v2")) {
        return quoteOf(parts, body);
      }
      const { next } = holds;
      if (next !== undefined) {
        delete holds.next;
        next();
        return undefined;
      }
      return statusOf(parts, crashHexSchema.parse(url.searchParams.get("hash")));
    },
    holdNextStatus: async () =>
      new Promise((resolve) => {
        holds.next = resolve;
      }),
  };
}
