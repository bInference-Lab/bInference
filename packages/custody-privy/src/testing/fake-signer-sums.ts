import type { AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ServiceSums } from "../signing/signer-service-wire.schema.js";

/** A sum the service keeps, and how many base units of its asset one dollar buys at its floor. */
export interface FakeSumAsset {
  readonly asset: AssetRef;
  readonly baseUnitsPerUsd: bigint;
}

/** One reservation of the fake service's store (spec 5, section 8.4). */
export interface FakeReservation {
  readonly id: number;
  /** The wallet's address, lowercase. */
  readonly account: string;
  readonly nonce: number;
  readonly intent: Id<"int">;
  readonly step: number;
  readonly nativeBase: bigint;
  readonly tokenBase: bigint;
  readonly token?: AssetRef;
  readonly state: "reserved" | "signed" | "released";
  readonly reservedAtMs: number;
}

/** What one transaction adds to the sums, and which of its sums may refuse it (decision 0426). */
export interface SumsAsk {
  readonly nativeBase: bigint;
  /** A call's native value may be refused; a send's and a cancel's never. */
  readonly nativeRefusable: boolean;
  /** An approval of a capped token, which its token's sum may refuse. */
  readonly approval?: { readonly token: AssetRef; readonly amountBase: bigint };
}

/** The sums one install keeps on the fake's chain, sized by its dollar cap. */
export interface SumsBook {
  readonly chain: ServiceSums["chain"];
  readonly native: FakeSumAsset;
  readonly tokens: readonly FakeSumAsset[];
  /** The install's 24-hour cap in dollars; the deploy's maximum caps it. */
  readonly dayCapUsd: bigint;
  readonly maxUsd: bigint;
}

const dayMs = 86_400_000;

function capOf(book: SumsBook, sum: FakeSumAsset): bigint {
  const usd = book.dayCapUsd < book.maxUsd ? book.dayCapUsd : book.maxUsd;
  return usd * sum.baseUnitsPerUsd;
}

function amountIn(reservation: FakeReservation, asset: AssetRef, native: AssetRef): bigint {
  if (asset === native) {
    return reservation.nativeBase;
  }
  return reservation.token === asset ? reservation.tokenBase : 0n;
}

// When enough of the window's oldest reservations age out to take `over` off the sum.
function roomAt(
  window: readonly FakeReservation[],
  sum: { readonly asset: AssetRef; readonly native: AssetRef; readonly over: bigint },
  nowMs: number,
): number {
  let left = sum.over;
  for (const reservation of window.toSorted(
    (one, other) => one.reservedAtMs - other.reservedAtMs,
  )) {
    left -= amountIn(reservation, sum.asset, sum.native);
    if (left <= 0n) {
      return reservation.reservedAtMs + dayMs;
    }
  }
  return nowMs + dayMs;
}

/** The reservations a sum counts now: younger than 24 hours, and not released. */
export function windowOf(
  reservations: readonly FakeReservation[],
  nowMs: number,
): readonly FakeReservation[] {
  return reservations.filter(
    (reservation) => reservation.state !== "released" && nowMs - reservation.reservedAtMs < dayMs,
  );
}

/**
 * The first sum the ask would pass, among the sums that may refuse it, or undefined: a call's
 * native value against the chain's native sum, an approval against its token's sum. What `held`
 * already counts for the same step is used, and only what the ask adds past it is asked.
 */
export function overSums(
  book: SumsBook,
  input: {
    readonly window: readonly FakeReservation[];
    readonly ask: SumsAsk;
    readonly held?: FakeReservation;
    readonly nowMs: number;
  },
): ServiceSums | undefined {
  const { ask, held, window, nowMs } = input;
  const native = book.native.asset;
  const checks = [
    ...(ask.nativeRefusable ? [{ sum: book.native, asked: ask.nativeBase }] : []),
    ...book.tokens
      .filter((sum) => sum.asset === ask.approval?.token)
      .map((sum) => ({ sum, asked: ask.approval?.amountBase ?? 0n })),
  ];
  for (const { sum, asked } of checks) {
    const before = held === undefined ? 0n : amountIn(held, sum.asset, native);
    const askedBase = asked > before ? asked - before : 0n;
    const usedBase = window.reduce((total, one) => total + amountIn(one, sum.asset, native), 0n);
    const capBase = capOf(book, sum);
    if (askedBase > 0n && usedBase + askedBase > capBase) {
      const over = usedBase + askedBase - capBase;
      const roomAtMs = roomAt(window, { asset: sum.asset, native, over }, nowMs);
      return { chain: book.chain, asset: sum.asset, capBase, usedBase, askedBase, roomAtMs };
    }
  }
  return undefined;
}

/** Whether the token is one the chain caps, so its approvals count. */
export function isCapped(book: SumsBook, token: AssetRef): boolean {
  return book.tokens.some((sum) => sum.asset === token);
}

/** A held reservation counting the larger of its own amounts and the ask's, of each sum. */
export function grownBy(held: FakeReservation, ask: SumsAsk): FakeReservation {
  const tokenBase = ask.approval?.amountBase ?? 0n;
  return {
    ...held,
    nativeBase: held.nativeBase > ask.nativeBase ? held.nativeBase : ask.nativeBase,
    tokenBase: held.tokenBase > tokenBase ? held.tokenBase : tokenBase,
  };
}
