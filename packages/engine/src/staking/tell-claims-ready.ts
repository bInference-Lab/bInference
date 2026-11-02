import type { Clock, Id } from "@binference/core";
import { addressPartOf, shortAddress } from "@binference/i18n";
import type { InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { UnbondingStore } from "./ports.js";
import type { UnbondingRecord } from "./unbonding-record.js";

// The message key of an unstake's coin ready to claim (spec 4, section 4).
const claimReadyNoticeKey = "notice.claimReady";

/** What the ready unbondings are read from, the agent they name found through, and told by. */
export interface ClaimReadyParts {
  readonly unbondings: Pick<UnbondingStore, "untoldReady" | "markTold">;
  readonly install: Pick<InstallStore, "read">;
  readonly publish: PublishPush;
  readonly clock: Clock;
  /**
   * Whether a row is a live one of a liquid venue, which the watch of its venue's queue tells of
   * instead (decision 0331); none is when absent.
   */
  readonly isWatched?: (row: UnbondingRecord) => boolean;
}

// The most unbondings one pass tells of; the rest wait for the next pass.
const maxTold = 100;
// The most ready rows one pass reads, so rows a venue's queue still holds hide no other.
const maxRead = 1_000;

function noticeOf(row: UnbondingRecord, agent: Id<"agt"> | undefined) {
  const validator =
    row.validator === undefined ? row.venue : shortAddress(addressPartOf(row.validator));
  return noticePush({
    key: claimReadyNoticeKey,
    ...(agent === undefined ? {} : { agent }),
    values: { validator },
    amounts: { amount: row.amount },
  });
}

/**
 * Tells the owner once of each unstake's coin a claim can take now (spec 4, section 4; decisions
 * 0327 and 0331): every unbonding no claim took whose ready time came and that the owner was not
 * told of, live or paper, as `notice.claimReady` with its coin and validator, at most 100 a pass;
 * a live row of a liquid venue is left to the watch of its venue's queue. It marks them told after
 * it published, so a stop between the two tells of them again rather than never. Answers how many
 * it told of.
 */
export async function tellClaimsReady(
  parts: ClaimReadyParts,
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const nowMs = parts.clock.now();
  const due = await parts.unbondings.untoldReady({ nowMs, limit: maxRead }, call);
  const { isWatched = () => false } = parts;
  const ready = due.filter((row) => !isWatched(row)).slice(0, maxTold);
  if (ready.length === 0) {
    return 0;
  }
  const { wallets } = await parts.install.read(call);
  for (const row of ready) {
    const agent = wallets.find((wallet) => wallet.id === row.walletId)?.agentId;
    parts.publish(noticeOf(row, agent));
  }
  await parts.unbondings.markTold({ ids: ready.map((row) => row.id), atMs: nowMs }, call);
  return ready.length;
}
