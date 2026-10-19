import { type Amount, amountSchema, type AssetRef, assetRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import type { TokenFacts } from "../money-path/token-facts.js";
import { epochMsSchema } from "../records/record-fields.js";

/** The window a copy order's daily cap counts its buys in: the last 24 hours (decision 0260). */
export const copyDayMs = 86_400_000;

/**
 * How late a leader's trade may still be copied as it came (decision 0260): its block time at most
 * this long before its copy reaches the head of its agent's line of fills. A later buy is never
 * made; a later sale is still made, at the price then, and told as late.
 */
export const copyGraceMs = 60_000;

/** Whether a taken trade's copy at `atMs` comes past its minute. */
export function isTakenLate(taking: Pick<CopyTaking, "atMs">, atMs: number): boolean {
  return atMs - taking.atMs > copyGraceMs;
}

/** The leader's trade a copy order took and copies now (decision 0260). */
export interface CopyTaking {
  /** The trade's number in the store, which orders the leader's trades. */
  readonly id: number;
  readonly side: "buy" | "sell";
  /** The token the leader bought or sold, in its canonical form. */
  readonly asset: AssetRef;
  /** For a sale: the share of its holding the leader sold, when the watcher could read it. */
  readonly shareSoldBps?: Bps;
  /** The trade's block time. */
  readonly atMs: number;
  /** For a buy: what the leader paid for it, which caps the copy's dollars (decision 0260). */
  readonly paid?: Amount;
  /** When the order took it: the start's repair reads whether a fill row came since. */
  readonly takenAtMs: number;
  /**
   * The token's symbol, name and decimals as the order took the trade: the registry's, marked
   * verified, else what its contract answered on chain. Its notices name it by them, and its fill
   * needs the decimals; absent for a token that answered none.
   */
  readonly facts?: TokenFacts & { readonly verified: boolean };
}

/** One copied buy the daily cap counts: when it filled and its value in micro-dollars. */
interface CopyBuy {
  readonly atMs: number;
  readonly usdMicros: bigint;
}

/** What a copy order holds of one token from its own buys, in base units. */
interface CopyHolding {
  readonly asset: AssetRef;
  readonly base: bigint;
}

/**
 * What a copy order keeps in its trigger state (decision 0260): since when it copies, the last
 * leader trade it took, the trade under way, its buys of the last 24 hours, and what its buys
 * bought less what its sales sold, token by token.
 */
export interface CopyState {
  /** When the order became active: the leader's trades from before are not its own. */
  readonly sinceMs: number;
  /** The number of the last leader trade it took or passed over; 0 before the first. */
  readonly through: number;
  readonly taking?: CopyTaking;
  readonly buys: readonly CopyBuy[];
  readonly held: readonly CopyHolding[];
}

const copyStateSchema: z.ZodType<CopyState> = z.strictObject({
  sinceMs: epochMsSchema,
  through: z.int().nonnegative(),
  taking: z
    .strictObject({
      id: z.int().positive(),
      side: z.enum(["buy", "sell"]),
      asset: assetRefSchema,
      shareSoldBps: bpsSchema.exactOptional(),
      atMs: epochMsSchema,
      paid: amountSchema.exactOptional(),
      takenAtMs: epochMsSchema,
      facts: z
        .strictObject({
          symbol: z.string().max(200),
          name: z.string().max(200),
          decimals: z.int().min(0).max(255),
          verified: z.boolean(),
        })
        .exactOptional(),
    })
    .exactOptional(),
  buys: z.array(z.strictObject({ atMs: epochMsSchema, usdMicros: decimalStringSchema })),
  held: z.array(z.strictObject({ asset: assetRefSchema, base: decimalStringSchema })),
});

/** A copy order's state as its `trigger_state` holds it: amounts as decimal strings. */
export const copyStateDocument: DocumentCodec<CopyState> = documentCodec(
  "copy state",
  copyStateSchema,
);

/** A copy order's state, or none when its trigger state does not read as one. */
export function copyStateOf(kept: JsonValue | undefined): CopyState | undefined {
  const parsed = copyStateSchema.safeParse(kept);
  return parsed.success ? parsed.data : undefined;
}

/** The state a copy order starts with as it becomes active at `nowMs`. */
export function copyStartOf(nowMs: number): CopyState {
  return { sinceMs: nowMs, through: 0, buys: [], held: [] };
}

/**
 * What the order's buys of the 24 hours before `nowMs` count against its daily cap, in
 * micro-dollars.
 */
export function usedInDayOf(state: CopyState, nowMs: number): bigint {
  return state.buys
    .filter(({ atMs }) => atMs > nowMs - copyDayMs)
    .reduce((sum, { usdMicros }) => sum + usdMicros, 0n);
}

/** What the order holds of a token from its own buys, less what its sales sold. */
export function copiedHeldOf(state: CopyState, asset: AssetRef): bigint {
  return state.held.find((holding) => holding.asset === asset)?.base ?? 0n;
}

/** The state once the order took a leader's trade, which it copies now. */
export function takenState(state: CopyState, taking: CopyTaking): CopyState {
  return { ...state, through: taking.id, taking };
}

/** The state once the order passed over the leader's trades up to number `through`. */
export function passedState(state: CopyState, through: number): CopyState {
  const { taking: _taking, ...rest } = state;
  return { ...rest, through };
}

/** What a copy order's fill traded, which its state counts as the fill records. */
export interface CopyTraded {
  readonly side: "buy" | "sell";
  readonly amountIn: Amount;
  readonly amountOut: Amount;
  /** What a buy counts against the daily cap, in micro-dollars. */
  readonly usdMicros: bigint;
  readonly atMs: number;
}

function addHeld(held: readonly CopyHolding[], asset: AssetRef, base: bigint): CopyHolding[] {
  const before = held.find((holding) => holding.asset === asset)?.base ?? 0n;
  const after = before + base;
  const others = held.filter((holding) => holding.asset !== asset);
  return after > 0n ? [...others, { asset, base: after }] : others;
}

/**
 * The state once a copy fill traded (decision 0260): a buy adds what it bought to the token's
 * holding and its value to the day's buys; a sale takes what it sold from the holding, never below
 * zero. Buys older than a day are dropped, and the trade under way is done.
 */
export function copyStateAfterFill(state: CopyState, traded: CopyTraded): CopyState {
  const { taking: _taking, ...rest } = state;
  const recent = state.buys.filter(({ atMs }) => atMs > traded.atMs - copyDayMs);
  if (traded.side === "buy") {
    const { asset, base } = traded.amountOut;
    const buys = [...recent, { atMs: traded.atMs, usdMicros: traded.usdMicros }];
    return { ...rest, buys, held: addHeld(state.held, asset, base) };
  }
  const { asset, base } = traded.amountIn;
  const sold = base < copiedHeldOf(state, asset) ? base : copiedHeldOf(state, asset);
  return { ...rest, buys: recent, held: addHeld(state.held, asset, -sold) };
}
