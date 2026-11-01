import {
  assetRefSchema,
  err,
  type LandedRequest,
  type LandedStake,
  ok,
  type Result,
} from "@binference/plugin-sdk";
import { type Address, decodeEventLog, getAddress, parseAbi } from "viem";
import { z } from "zod";
import { creditOfWalletRead, creditRead, unbondRequestRead } from "../hub/hub-calls.js";
import { readEach, required, unreadable } from "../hub/hub-read.js";
import { requestRefOf } from "../hub/read-holdings.js";
import type { OptionsRead } from "../hub/read-options.js";

// StakeHub's events of the three moves, from `StakeHub.sol`.
const eventsAbi = parseAbi([
  "event Delegated(address indexed operatorAddress, address indexed delegator, uint256 shares, uint256 bnbAmount)",
  "event Undelegated(address indexed operatorAddress, address indexed delegator, uint256 shares, uint256 bnbAmount)",
  "event Claimed(address indexed operatorAddress, address indexed delegator, uint256 bnbAmount)",
]);

const eventOf = { stake: "Delegated", unstake: "Undelegated", claim: "Claimed" } as const;
const msPerSecond = 1_000n;

const hexSchema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]*$/)]);
const receiptSchema = z
  .object({
    status: hexSchema,
    blockNumber: hexSchema,
    logs: z.array(z.object({ address: hexSchema, topics: z.array(hexSchema), data: hexSchema })),
  })
  .nullable();

/** The move to read back, with its wallet and validator as EVM addresses. */
export interface LandedAsk {
  readonly move: LandedRequest;
  readonly wallet: Address;
  readonly validator: Address;
}

/** The move's own event: its shares and coin. */
interface MoveEvent {
  readonly shares?: bigint;
  readonly bnbAmount: bigint;
}

// The transaction's event of the move, from StakeHub, naming the validator and the wallet; none for
// a revert or another move.
function eventIn(
  at: OptionsRead,
  ask: LandedAsk,
  logs: NonNullable<z.infer<typeof receiptSchema>>["logs"],
): MoveEvent | undefined {
  const wanted = eventOf[ask.move.action];
  for (const log of logs) {
    const [first, ...rest] = log.topics;
    if (getAddress(log.address) !== at.hub || first === undefined) {
      continue;
    }
    try {
      const event = decodeEventLog({ abi: eventsAbi, data: log.data, topics: [first, ...rest] });
      const isOwn =
        event.eventName === wanted &&
        getAddress(event.args.operatorAddress) === ask.validator &&
        getAddress(event.args.delegator) === ask.wallet;
      if (isOwn) {
        return event.args;
      }
    } catch {
      // A log of another event of StakeHub's is no move.
    }
  }
  return undefined;
}

async function receiptOf(at: OptionsRead, hash: string) {
  const reply = await at.rpc.request({
    method: "eth_getTransactionReceipt",
    params: [hash],
    result: receiptSchema,
    signal: at.signal,
  });
  if (reply.kind === "error") {
    throw unreadable("a transaction's receipt could not be read.");
  }
  return reply.value;
}

// An unstake's request: the newest of the wallet's queue at the landing block, with the sequence
// number the unstake took and the unlock time StakeHub set from that block.
async function requestOf(
  at: OptionsRead,
  ask: LandedAsk,
  { credit, burned }: { readonly credit: Address; readonly burned: MoveEvent },
) {
  const [count, next] = await readEach(at, [
    creditOfWalletRead(credit, "pendingUnbondRequest", ask.wallet),
    creditOfWalletRead(credit, "unbondSequence", ask.wallet),
  ]);
  const pending = required(count, "a count of unbond requests");
  const [request] = await readEach(at, [unbondRequestRead(credit, ask.wallet, pending - 1n)]);
  const read = required(request, "an unbond request");
  if (read.shares !== burned.shares || read.bnbAmount !== burned.bnbAmount) {
    throw unreadable("an unstake's request does not match its event.");
  }
  return {
    ref: requestRefOf(credit, required(next, "an unbond sequence") - 1n),
    amount: { asset: at.coin, base: read.bnbAmount },
    readyAtMs: Number(read.unlockTime * msPerSecond),
  };
}

// A claim's parts: the requests between the queue's front before the landing block and after it.
async function claimedOf(at: OptionsRead, ask: LandedAsk, credit: Address) {
  const before = { ...at, block: at.block - 1n };
  const [[pendingBefore], [pendingAfter, next]] = await Promise.all([
    readEach(before, [creditOfWalletRead(credit, "pendingUnbondRequest", ask.wallet)]),
    readEach(at, [
      creditOfWalletRead(credit, "pendingUnbondRequest", ask.wallet),
      creditOfWalletRead(credit, "unbondSequence", ask.wallet),
    ]),
  ]);
  const first = required(next, "an unbond sequence") - required(pendingBefore, "a queue");
  const taken = required(pendingBefore, "a queue") - required(pendingAfter, "a queue");
  return Array.from({ length: Number(taken) }, (_, index) =>
    requestRefOf(credit, first + BigInt(index)),
  );
}

/**
 * Reads back what a landed move of the wallet with the validator did (decision 0324): its own
 * `Delegated`, `Undelegated` or `Claimed` event in the transaction's receipt, and the credit
 * contract at the landing block: a stake's minted shares, an unstake's request with its reference
 * and the unlock time StakeHub set, a claim's parts. A transaction not mined, reverted, or holding
 * no such event is `not_found`. A credit contract whose request does not match the event is
 * `stakehub.read_failed`.
 */
export async function readLanded(
  at: OptionsRead,
  ask: LandedAsk,
): Promise<Result<LandedStake, "not_found">> {
  const receipt = await receiptOf(at, ask.move.hash);
  const found = receipt?.status === "0x1" ? eventIn(at, ask, receipt.logs) : undefined;
  if (receipt === null || found === undefined) {
    return err("not_found");
  }
  const landing = { ...at, block: BigInt(receipt.blockNumber) };
  const [credit] = await readEach(landing, [creditRead(at.hub, ask.validator)]);
  const contract = required(credit, "getValidatorCreditContract");
  const { action, validator } = ask.move;
  const moved = { asset: at.coin, base: found.bnbAmount };
  const shares = (base: bigint) => ({
    asset: assetRefSchema.parse(`${at.chain}/erc20:${contract}`),
    base,
  });
  if (action === "claim") {
    return ok({ action, validator, moved, claimed: await claimedOf(landing, ask, contract) });
  }
  const minted = shares(found.shares ?? 0n);
  if (action === "stake") {
    return ok({ action, validator, moved, shares: minted });
  }
  const request = await requestOf(landing, ask, { credit: contract, burned: found });
  return ok({ action, validator, moved, shares: minted, request });
}
