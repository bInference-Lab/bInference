import {
  err,
  type LandedRequest,
  type LandedStake,
  ok,
  type Result,
  type UnbondingPart,
} from "@binference/plugin-sdk";
import { decodeLog } from "@binference/plugin-sdk/evm";
import { type Address, getAddress, parseAbi, zeroAddress } from "viem";
import { z } from "zod";
import { readManagerCall } from "../calls/manager-calls.js";
import {
  type ListaAt,
  plainRead,
  readViews,
  requestsOf,
  requestsRead,
  statusOf,
  statusRead,
  uintOf,
  unreadable,
} from "../manager/manager-read.js";

// The stake manager's events of the three moves, from `IStakeManager.sol`, and slisBNB's mint. An
// event's topic is its name and types, so the parameters are named here as this file reads them.
const eventsAbi = parseAbi([
  "event Deposit(address src, uint256 amount)",
  "event RequestWithdraw(address indexed account, uint256 units)",
  "event ClaimWithdrawal(address indexed account, uint256 index, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const hexSchema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]*$/)]);
const logSchema = z.object({ address: hexSchema, topics: z.array(hexSchema), data: hexSchema });
const receiptSchema = z
  .object({ status: hexSchema, blockNumber: hexSchema, logs: z.array(logSchema) })
  .nullable();
const transactionSchema = z
  .object({ from: hexSchema, to: hexSchema.nullable(), input: hexSchema })
  .nullable();

type Log = z.infer<typeof logSchema>;
const msPerSecond = 1_000n;

/** The move to read back, with its wallet as an EVM address. */
export interface LandedAsk {
  readonly move: LandedRequest;
  readonly wallet: Address;
}

// What a node answers of the transaction, by the method asked; no answer is a fault.
async function nodeRead<T>(
  at: ListaAt,
  ask: { readonly method: string; readonly hash: string; readonly result: z.ZodType<T> },
): Promise<T> {
  const { method, hash, result } = ask;
  const reply = await at.rpc.request({ method, params: [hash], result, signal: at.signal });
  if (reply.kind === "error") {
    throw unreadable(`${method} could not be read.`);
  }
  return reply.value;
}

// The events the contract wrote in the transaction.
function eventsIn(logs: readonly Log[], contract: Address) {
  return logs.flatMap((log) => {
    const event = getAddress(log.address) === contract ? decodeLog(eventsAbi, log) : undefined;
    return event === undefined ? [] : [event];
  });
}

// A stake: the stake manager's deposit from the wallet, and the slisBNB it minted to the wallet.
function stakeOf(at: ListaAt, ask: LandedAsk, logs: readonly Log[]): LandedStake | undefined {
  const deposit = eventsIn(logs, at.manager).find(
    (event) => event.eventName === "Deposit" && getAddress(event.args.src) === ask.wallet,
  );
  const minted = eventsIn(logs, at.token).find(
    (event) =>
      event.eventName === "Transfer" &&
      event.args.from === zeroAddress &&
      getAddress(event.args.to) === ask.wallet,
  );
  if (deposit?.eventName !== "Deposit" || minted?.eventName !== "Transfer") {
    return undefined;
  }
  const { action, validator } = ask.move;
  const moved = { asset: at.coin, base: deposit.args.amount };
  return { action, validator, moved, shares: { asset: at.receipt, base: minted.args.value } };
}

// An unstake's request: the wallet's one request of these units made in the landing block, with
// what a claim of it pays and its earliest time by the stake manager at that block.
async function requestOf(
  at: ListaAt,
  ask: LandedAsk,
  landing: { readonly block: bigint; readonly units: bigint },
): Promise<UnbondingPart | undefined> {
  const reads = [
    plainRead(at.multicall, "getCurrentBlockTimestamp"),
    plainRead(at.stakeHub, "unbondPeriod"),
    requestsRead(at.manager, ask.wallet),
  ];
  const [time, unbonding, listed] = await readViews(at, reads, landing.block);
  const startTime = uintOf(time, "the block time");
  const matching = requestsOf(listed).flatMap((request, index) =>
    request.startTime === startTime && request.units === landing.units ? [{ request, index }] : [],
  );
  const [found, ...more] = matching;
  if (found === undefined || more.length > 0) {
    return undefined;
  }
  const status = statusRead(at.manager, ask.wallet, BigInt(found.index));
  const [answer] = await readViews(at, [status], landing.block);
  const { amount, isClaimable } = statusOf(answer);
  const earliest = (startTime + uintOf(unbonding, "StakeHub's unbondPeriod")) * msPerSecond;
  return {
    ref: found.request.uuid.toString(),
    amount: { asset: at.coin, base: amount },
    readyAtMs: Number(earliest),
    ...(isClaimable ? {} : { queued: true as const }),
  };
}

async function unstakeOf(
  at: ListaAt,
  ask: LandedAsk,
  landing: { readonly block: bigint; readonly logs: readonly Log[] },
): Promise<LandedStake | undefined> {
  const event = eventsIn(landing.logs, at.manager).find(
    (item) => item.eventName === "RequestWithdraw" && getAddress(item.args.account) === ask.wallet,
  );
  if (event?.eventName !== "RequestWithdraw") {
    return undefined;
  }
  const units = event.args.units;
  const request = await requestOf(at, ask, { block: landing.block, units });
  if (request === undefined) {
    return undefined;
  }
  const { action, validator } = ask.move;
  const shares = { asset: at.receipt, base: units };
  return { action, validator, moved: request.amount, shares, request };
}

// The request id the wallet's own call to the stake manager claimed, read from the transaction.
async function claimedUuid(at: ListaAt, ask: LandedAsk): Promise<bigint | undefined> {
  const sent = await nodeRead(at, {
    method: "eth_getTransactionByHash",
    hash: ask.move.hash,
    result: transactionSchema,
  });
  if (sent?.to === null || sent === null) {
    return undefined;
  }
  const isOwn = getAddress(sent.from) === ask.wallet && getAddress(sent.to) === at.manager;
  const call = readManagerCall(sent.input);
  return isOwn && call?.name === "claimWithdrawByUUID" ? call.uuid : undefined;
}

// A claim: the request its own call named, by id, and what the stake manager paid the wallet.
async function claimOf(
  at: ListaAt,
  ask: LandedAsk,
  logs: readonly Log[],
): Promise<LandedStake | undefined> {
  const paid = eventsIn(logs, at.manager).find(
    (event) =>
      event.eventName === "ClaimWithdrawal" && getAddress(event.args.account) === ask.wallet,
  );
  const uuid = await claimedUuid(at, ask);
  if (paid?.eventName !== "ClaimWithdrawal" || uuid === undefined) {
    return undefined;
  }
  const { action, validator } = ask.move;
  const moved = { asset: at.coin, base: paid.args.amount };
  return { action, validator, moved, claimed: [uuid.toString()] };
}

async function moveOf(
  at: ListaAt,
  ask: LandedAsk,
  landing: { readonly block: bigint; readonly logs: readonly Log[] },
): Promise<LandedStake | undefined> {
  const { action } = ask.move;
  if (action === "stake") {
    return stakeOf(at, ask, landing.logs);
  }
  return action === "unstake" ? unstakeOf(at, ask, landing) : claimOf(at, ask, landing.logs);
}

/**
 * What the wallet's landed move did, from its own events and the stake manager at its block: a
 * stake's coin and the slisBNB it minted; an unstake's units, its request by id with what a claim
 * pays and its earliest time; a claim's request, named by its own call, and the coin paid. A
 * transaction that reverted, holds no such move of the wallet, or whose request the stake manager
 * lists more than once in that block with those units, is `not_found`.
 */
export async function readLanded(
  at: ListaAt,
  ask: LandedAsk,
): Promise<Result<LandedStake, "not_found">> {
  const receipt = await nodeRead(at, {
    method: "eth_getTransactionReceipt",
    hash: ask.move.hash,
    result: receiptSchema,
  });
  if (receipt === null || BigInt(receipt.status) !== 1n) {
    return err("not_found");
  }
  const landing = { block: BigInt(receipt.blockNumber), logs: receipt.logs };
  const read = await moveOf(at, ask, landing);
  return read === undefined ? err("not_found") : ok(read);
}
