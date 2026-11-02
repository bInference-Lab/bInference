import type { ChainRef } from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { z } from "zod";
import type { CallCap, CeilingRead } from "../install/ceiling-change.js";

const abiNameSchema = z.object({ name: z.string().min(1) });

/**
 * The call a staking venue declares with a cap of its own on the chain (decision 0325), such as
 * StakeHub's stake, with that cap; none when it declares no such call. The largest cap leads when a
 * venue declares several.
 */
export function ownCapCallOf(venue: StakingVenue, chain: ChainRef): CallCap | undefined {
  const caps = venue.contracts
    .filter((contracts) => contracts.chain === chain)
    .flatMap((contracts) => contracts.calls ?? [])
    .flatMap((call): CallCap[] => {
      const named = abiNameSchema.safeParse(call.abi);
      return call.maxValueBase === undefined || !named.success
        ? []
        : [{ functionName: named.data.name, maxValueBase: call.maxValueBase }];
    });
  return caps.reduce<CallCap | undefined>(
    (largest, cap) =>
      largest === undefined || cap.maxValueBase > largest.maxValueBase ? cap : largest,
    undefined,
  );
}

/**
 * What one stake may carry under the wallet's stored ceiling (decision 0327): the cap its rule for
 * the venue's own-cap call holds, else the ceiling's cap per call, which a ceiling written before
 * decision 0325 holds every stake to; with no ceiling it can read, `fallback`, the cap the
 * wallet's facts give.
 */
export function storedStakeCap(
  read: CeilingRead | undefined,
  call: CallCap | undefined,
  fallback: bigint,
): bigint {
  if (read === undefined) {
    return fallback;
  }
  const own = read.ownCaps?.find((cap) => cap.functionName === call?.functionName);
  return own?.maxValueBase ?? read.perTxNativeBase;
}
