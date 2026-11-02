import { accountRefParts, type Signer } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { StakingHost } from "../venues/staking-host.js";
import type { UnbondingRecord } from "./unbonding-record.js";

/** What a liquid venue's part is read through: the host, custody's wallet accounts, a clock. */
export interface ReleaseParts {
  readonly staking: StakingHost;
  readonly custody: Pick<Signer, "account">;
  readonly clock: Clock;
}

/**
 * Whether an unbonding's coin can be claimed now by its venue's word (decision 0331): a live part
 * of a liquid venue only once the venue reads it in the wallet's holding as ready, since its own
 * queue releases it, maybe after the time the row holds; a paper part, or one of a venue of
 * validators, by the row's time alone. A venue or a wallet that cannot be read says no, so the
 * owner is told on a later pass.
 */
export async function isReleased(
  parts: ReleaseParts,
  row: UnbondingRecord,
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const { validator } = row;
  if (row.isPaper || validator === undefined) {
    return true;
  }
  const chain = accountRefParts(validator).chain;
  const venue = parts.staking.venueOn(row.venue, chain);
  if (venue?.pool === undefined) {
    return true;
  }
  const account = await parts.custody.account(row.walletId, chain, call);
  if (!account.ok) {
    return false;
  }
  const held = await parts.staking.parts(venue, { wallet: account.value, validator }, call);
  const nowMs = parts.clock.now();
  return (
    held.ok &&
    held.value.some(
      (part) => part.ref === row.requestRef && part.queued !== true && part.readyAtMs <= nowMs,
    )
  );
}
