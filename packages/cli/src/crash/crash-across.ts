import { notFoundAnswer, usdcToBaseAnswer, withWord } from "@binference/across/testing";
import { bsc } from "@binference/chains";
import { type HttpResponse, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type Address,
  decodeEventLog,
  getAddress,
  type Hex,
  pad,
  parseAbi,
  toEventSelector,
  toFunctionSelector,
  toHex,
} from "viem";
import { z } from "zod";
import { createRecordedChain, type RecordedChain } from "../compose/test-recorded-chain.js";
import { type AcrossDeposited, acrossStatusOf, landBaseFill } from "../fork/across-base-fills.js";
import { assemble, fail, type Item, op, p, pullFromCaller } from "./crash-assembler.js";
import { crashContract } from "./crash-market.js";
import type { CrashApi } from "./crash-routes.js";
import { crashBalanceSlot, crashTokenCode } from "./crash-token.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** Across's SpokePool at its BSC address. */
export const crashSpokePool: Address = crashContract("across", "spoke-pool");

/** BSC's USDC, which a crash bridge sends. */
export const crashUsdc: Address = getAddress(
  bsc.tokens.find(({ symbol }) => symbol === "USDC")?.address ?? "",
);

/** What every crash bridge sends: the 20 USDC of Across's recorded quote to Base. */
export const crashBridgeAmount: bigint = 20n * 10n ** 18n;

const depositEvents = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);
const [fundsDeposited] = depositEvents;
const depositV3 = toFunctionSelector(
  "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
);

// The call data word at `from` to memory at `to`.
const copied = (from: number, to: number): readonly Item[] => [
  p(2, BigInt(from)),
  op.callDataLoad,
  p(2, BigInt(to)),
  op.mstore,
];

/**
 * The runtime code of the crash chain's SpokePool: `depositV3` takes the input from the caller
 * through its allowance, numbers the deposit from slot 0, and logs `FundsDeposited` as Across's
 * SpokePool does, its exclusivity deadline the call's exclusivity and its message empty; any other
 * call reverts.
 */
const spokePoolCode: Hex = assemble([
  p(1, 0n),
  op.callDataLoad,
  p(1, 0xe0n),
  op.shr,
  p(4, BigInt(depositV3)),
  op.eq,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  ...pullFromCaller([p(1, 0x44n), op.callDataLoad], [p(1, 0x84n), op.callDataLoad]),
  p(1, 0n),
  op.sload,
  op.dup1,
  p(1, 1n),
  op.add,
  p(1, 0n),
  op.sstore,
  ...copied(0x44, 0x00),
  ...copied(0x64, 0x20),
  ...copied(0x84, 0x40),
  ...copied(0xa4, 0x60),
  ...copied(0x104, 0x80),
  ...copied(0x124, 0xa0),
  ...copied(0x144, 0xc0),
  ...copied(0x24, 0xe0),
  ...copied(0xe4, 0x100),
  p(2, 0x140n),
  p(2, 0x120n),
  op.mstore,
  p(1, 0n),
  p(2, 0x140n),
  op.mstore,
  p(1, 4n),
  op.callDataLoad,
  op.dup2,
  p(1, 0xc4n),
  op.callDataLoad,
  p(32, BigInt(toEventSelector(fundsDeposited))),
  p(2, 0x160n),
  p(1, 0n),
  op.log4,
  op.stop,
  ...fail,
]);

const quoteSchema = z.looseObject({
  swapTx: z.looseObject({ data: z.string() }),
});

/**
 * Across's recorded quote of 20 USDC to Base, for the depositor and recipient asked and quoted
 * now: its deposit's depositor, recipient, quote time and fill deadline, and its expiry.
 */
function quoteOf(query: URLSearchParams): HttpResponse {
  const recorded = quoteSchema.parse(JSON.parse(usdcToBaseAnswer));
  const nowSeconds = BigInt(Math.floor(Date.now() / 1_000));
  const words: readonly (readonly [number, bigint])[] = [
    [0, BigInt(query.get("depositor") ?? "0x0")],
    [1, BigInt(query.get("recipient") ?? "0x0")],
    [8, nowSeconds],
    [9, nowSeconds + 3_600n],
  ];
  const data = words.reduce(
    (text, [index, value]) => withWord(text, index, value),
    recorded.swapTx.data,
  );
  const quote = {
    ...recorded,
    swapTx: { ...recorded.swapTx, data },
    quoteExpiryTimestamp: Number(nowSeconds + 600n),
  };
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(quote),
  };
}

const receiptSchema = z
  .looseObject({
    status: z.string(),
    logs: z.array(
      z.looseObject({ address: z.string(), topics: z.array(jsonValueSchema), data: z.string() }),
    ),
  })
  .nullable();
const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-f]*$/iu.test(value),
);

// The deposit the SpokePool logged in the transaction; none while it is unmined.
async function depositIn(anvil: AnvilCall, hash: Hex): Promise<AcrossDeposited | undefined> {
  const receipt = receiptSchema.parse(await anvil("eth_getTransactionReceipt", [hash]));
  const log = receipt?.logs.find(({ address }) => getAddress(address) === crashSpokePool);
  if (receipt?.status !== "0x1" || log === undefined) {
    return undefined;
  }
  const topics = z.array(hexSchema).parse(log.topics);
  const [first, ...rest] = topics;
  if (first === undefined) {
    return undefined;
  }
  const { args } = decodeEventLog({
    abi: depositEvents,
    data: hexSchema.parse(log.data),
    topics: [first, ...rest],
  });
  return { ...args, hash };
}

const json = (status: number, body: string): HttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body,
});

/** Across's API and Base as a crash run's bridges reach them, and the reads a run holds. */
export interface CrashAcross {
  /** Across's Swap API and deposit status, served at `/across`. */
  readonly api: CrashApi;
  /** Base's RPC, served at `/base`. */
  readonly base: CrashApi;
  /**
   * Holds the next deposit status request unanswered, as a follower that asked when the engine
   * was killed; resolves once it came.
   */
  readonly holdNextStatus: () => Promise<void>;
  /** Answers that the address holds no code on Base, as a person's wallet there. */
  readonly plainOnBase: (address: Address) => void;
}

// Across's deposit status: filled, and the fill landed on Base, once the deposit is mined; Across's
// "not found" before then.
async function statusOf(anvil: AnvilCall, base: RecordedChain, query: URLSearchParams) {
  const deposited = await depositIn(anvil, hexSchema.parse(query.get("depositTxnRef")));
  if (deposited === undefined) {
    return json(404, notFoundAnswer);
  }
  return json(200, acrossStatusOf(deposited, landBaseFill(base, deposited)));
}

/**
 * Installs Across's side of a bridge on the bare crash chain: at their BSC addresses, the SpokePool
 * above and USDC as the suite's ERC-20; and serves Across's API, whose quote is its recorded 20 USDC
 * to Base made out for the run's wallet and recipient, and whose deposit status lands Across's fill
 * on a recorded Base once the deposit is mined.
 */
export async function installCrashAcross(anvil: AnvilCall): Promise<CrashAcross> {
  await anvil("anvil_setCode", [crashSpokePool, spokePoolCode]);
  await anvil("anvil_setCode", [crashUsdc, crashTokenCode]);
  const base = createRecordedChain();
  base.answer("eth_chainId", [], "0x2105");
  const holds: { next?: () => void } = {};
  return {
    api: async ({ path }) => {
      const url = new URL(path, "https://app.across.to");
      if (url.pathname.endsWith("/swap/approval")) {
        return quoteOf(url.searchParams);
      }
      const { next } = holds;
      if (next !== undefined) {
        delete holds.next;
        next();
        return undefined;
      }
      return statusOf(anvil, base, url.searchParams);
    },
    base: async ({ body }) => {
      return base.http.request({
        method: "POST",
        url: "https://base.test",
        body,
        signal: AbortSignal.timeout(10_000),
      });
    },
    holdNextStatus: async () =>
      new Promise((resolve) => {
        holds.next = resolve;
      }),
    plainOnBase: (address) => {
      base.answer("eth_getCode", [getAddress(address), "latest"], "0x");
    },
  };
}

/** Gives the wallet `base` units of the crash chain's USDC, as a wallet that bought it earlier. */
export async function fundCrashUsdc(
  anvil: AnvilCall,
  holder: Address,
  base: bigint,
): Promise<void> {
  const units = pad(toHex(base), { size: 32 });
  await anvil("anvil_setStorageAt", [crashUsdc, crashBalanceSlot(holder), units]);
}
