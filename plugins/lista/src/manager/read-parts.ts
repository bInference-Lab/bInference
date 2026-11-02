import type { UnbondingPart } from "@binference/plugin-sdk";
import type { Address } from "viem";
import { type ListaAt, readViews, statusOf, statusRead } from "./manager-read.js";
import type { PoolRead } from "./read-pool.js";

/** The most requests of one wallet a read takes: the oldest of a longer list are read, the rest cut. */
const maxParts = 1_000;

const msPerSecond = 1_000;

/** A wallet's parts, oldest first, and whether its list held more than a read takes. */
export interface WalletParts {
  readonly parts: readonly UnbondingPart[];
  readonly isCut: boolean;
}

/**
 * The wallet's withdrawal requests as unbonding parts at the pool read's block, by the stake
 * manager's own word on each (decision 0331): a request Lista's queue released is ready by the
 * read, at the earliest time if that came first; one it holds is `queued`, ready no sooner than
 * its earliest time, its request's time plus StakeHub's unbonding time, and a millisecond after
 * the read. Each part's ref is the request's own id, and its amount what a claim of it pays.
 */
export async function readParts(
  at: ListaAt,
  read: PoolRead & { readonly wallet: Address },
): Promise<WalletParts> {
  const listed = read.requests ?? [];
  const taken = listed.slice(0, maxParts);
  const reads = taken.map((_request, index) => statusRead(at.manager, read.wallet, BigInt(index)));
  const answers = taken.length === 0 ? [] : await readViews(at, reads, read.state.block);
  const { timeMs, unbondingSeconds } = read.state;
  const parts = taken.map((request, index): UnbondingPart => {
    const status = statusOf(answers[index]);
    const earliest = Number(request.startTime) * msPerSecond + unbondingSeconds * msPerSecond;
    const part = { ref: request.uuid.toString(), amount: { asset: at.coin, base: status.amount } };
    return status.isClaimable
      ? { ...part, readyAtMs: Math.min(earliest, timeMs) }
      : { ...part, readyAtMs: Math.max(earliest, timeMs + 1), queued: true };
  });
  // Oldest first: a request's id counts up, and a claim's swap reorders the stake manager's list.
  const sorted = parts.toSorted((first, second) =>
    BigInt(first.ref) < BigInt(second.ref) ? -1 : 1,
  );
  return { parts: sorted, isCut: listed.length > taken.length };
}
