import { type AccountRef, accountRefParts } from "@binference/chain";
import type { PendingRescue } from "../policy/rescue-change.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a rescue address change (spec 4, section 4). */
export const rescueAddressNoticeKey = "notice.rescueAddress";

/**
 * The notice that announces a new rescue address on every surface, for the whole install: the
 * address and the time a rescue starts to pay it, so the owner can cancel a change they did not
 * ask for.
 */
export function rescueAddressNotice(pending: PendingRescue): EnginePush {
  return noticePush({
    key: rescueAddressNoticeKey,
    values: { address: accountRefParts(pending.address).address },
    times: { when: pending.atMs },
  });
}

/** The message key of the notice that announces a cancelled rescue address change. */
export const rescueAddressCancelledKey = "notice.rescueAddressCancelled";

/**
 * The notice that announces, for the whole install, that a new rescue address was dropped before
 * a rescue paid it: cancelled, or replaced by the address in effect.
 */
export function rescueCancelledNotice(dropped: PendingRescue): EnginePush {
  return noticePush({
    key: rescueAddressCancelledKey,
    values: { address: accountRefParts(dropped.address).address },
  });
}

/** The message key of the notice that says a ceiling still lists an old address. */
export const ceilingOutdatedKey = "notice.ceilingOutdated";

/**
 * The notice that tells the owner, for the whole install, that the wallets' ceilings still let a
 * send pay an address binference no longer pays: a change signed ahead could not be sent.
 */
export function ceilingOutdatedNotice(address: AccountRef): EnginePush {
  return noticePush({
    key: ceilingOutdatedKey,
    values: { address: accountRefParts(address).address },
  });
}
