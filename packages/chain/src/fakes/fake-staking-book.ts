import { BinferenceError, err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { Amount } from "../amount.js";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import type { DecodedStake, LandedStake, UnbondingPart } from "../staking/staking-terms.js";
import { isTxHash, type TxDraft, type TxHash } from "../transaction.js";
import { type FakeCall, fakeCallOf, isFakeAddress } from "./fake-draft.js";
import type { FakeValidator } from "./fake-staking-venue.js";

/** What the fake staking venue starts from. */
export interface FakeStakingOptions {
  readonly validators: readonly FakeValidator[];
  readonly minStakeBase: bigint;
  readonly unbondingSeconds: number;
  readonly nowMs: number;
}

interface Holding {
  readonly shares: bigint;
  readonly parts: readonly UnbondingPart[];
  /** The next request's sequence number with this validator. */
  readonly next: number;
}

// What the venue holds per wallet and validator, the moves that landed, and its clock.
export interface Book {
  readonly options: FakeStakingOptions;
  readonly nowMs: () => number;
  readonly holding: (wallet: AccountRef, validator: AccountRef) => Holding;
  readonly put: (wallet: AccountRef, validator: AccountRef, holding: Holding) => void;
  readonly pool: (validator: AccountRef) => bigint;
  readonly land: (move: LandedStake) => TxHash;
  readonly landed: (hash: TxHash) => LandedStake | undefined;
}

export const fakeChain: ChainRef = chainRefSchema.parse("fake:1");
export const coin: AssetRef = assetRefSchema.parse("fake:1/slip44:1");
export const hubAddress = "0x000000d1";
const msPerSecond = 1_000;
const countPattern = /^[1-9]\d{0,2}$/;
const sharesPattern = /^[1-9]\d{0,77}$/;
const empty: Holding = { shares: 0n, parts: [], next: 0 };
const partsSchema = z.coerce.number().int().positive();

export const account = (address: string): AccountRef => accountRefSchema.parse(`fake:1:${address}`);
export const amount = (base: bigint, asset: AssetRef = coin): Amount => ({ asset, base });
export const receiptOf = (validator: AccountRef): AssetRef =>
  assetRefSchema.parse(`fake:1/token:${accountRefParts(validator).address}`);
export const sum = (parts: readonly UnbondingPart[]): bigint =>
  parts.reduce((total, part) => total + part.amount.base, 0n);

export function wrong(problem: string): BinferenceError {
  return new BinferenceError({ code: "fake.bad_request", message: problem });
}

const keyOf = (wallet: AccountRef, validator: AccountRef): string => `${wallet} ${validator}`;

/** The fake's book: what it holds per wallet and validator, the moves that landed, its clock. */
export function createBook(
  options: FakeStakingOptions,
): Book & { readonly wait: (s: number) => void } {
  const holdings = new Map<string, Holding>();
  const moves = new Map<string, LandedStake>();
  const clock = { nowMs: options.nowMs };
  return {
    options,
    nowMs: () => clock.nowMs,
    holding: (wallet, validator) => holdings.get(keyOf(wallet, validator)) ?? empty,
    put: (wallet, validator, holding) => holdings.set(keyOf(wallet, validator), holding),
    pool: (validator) => {
      let total = 0n;
      for (const [key, held] of holdings) {
        total += key.endsWith(` ${validator}`) ? held.shares : 0n;
      }
      return total;
    },
    land: (move) => {
      const hash = `0x${(moves.size + 1).toString(16).padStart(8, "0")}`;
      if (!isTxHash(hash)) {
        throw wrong("The fake staking venue made a hash outside the id grammar.");
      }
      moves.set(hash, move);
      return hash;
    },
    landed: (hash) => moves.get(hash),
    wait: (seconds) => {
      clock.nowMs += seconds * msPerSecond;
    },
  };
}

// The parts a claim can take now: the oldest ones, up to the first that is not ready.
export function readyParts(book: Book, parts: readonly UnbondingPart[]): readonly UnbondingPart[] {
  const waiting = parts.findIndex((part) => part.readyAtMs > book.nowMs());
  return waiting === -1 ? parts : parts.slice(0, waiting);
}

export function readyAt(book: Book): number {
  return book.nowMs() + book.options.unbondingSeconds * msPerSecond;
}

type Move = Omit<DecodedStake, "contract" | "validator" | "credits">;

// An unstake's shares or a claim's parts, each a count in decimal that is never zero; a claim
// takes at most 999 parts.
function countedMove(action: string | undefined, count: string): Move | undefined {
  if (action === "undelegate" && sharesPattern.test(count)) {
    return { action: "unstake", value: 0n, shares: BigInt(count) };
  }
  return action === "claim" && countPattern.test(count)
    ? { action: "claim", value: 0n, parts: partsSchema.parse(count) }
    : undefined;
}

function moveOf(call: FakeCall, words: readonly string[]): Move | undefined {
  const [action, , count = ""] = words;
  if (action === "delegate" && words.length === 2 && call.value > 0n) {
    return { action: "stake", value: call.value };
  }
  return words.length === 3 && call.value === 0n ? countedMove(action, count) : undefined;
}

export function decodeFake(draft: TxDraft): Result<DecodedStake, "unknown_call"> {
  const call = fakeCallOf(draft);
  const words = call?.data.split(",") ?? [];
  const address = words[1] ?? "";
  const move = call?.to === hubAddress && isFakeAddress(address) ? moveOf(call, words) : undefined;
  if (move === undefined) {
    return err("unknown_call");
  }
  const contract = account(hubAddress);
  return ok({ ...move, contract, validator: account(address), credits: draft.from });
}
