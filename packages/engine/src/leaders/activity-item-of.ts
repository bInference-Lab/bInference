import type { ActivityItem } from "@binference/protocol";
import { z } from "zod";
import type { StoredActivity } from "./tracked-wallet-record.js";

const blockNumberSchema = z.bigint().pipe(z.coerce.number()).pipe(z.int().nonnegative());

/** A stored trade as `wallet/activity` and a wallet alert's fire show it (protocol spec, 7.3). */
export function activityItemOf(trade: StoredActivity): ActivityItem {
  return {
    at: trade.atMs,
    block: blockNumberSchema.parse(trade.block),
    tx: trade.txHash,
    side: trade.side,
    asset: trade.asset,
    amount: trade.amount,
    counterAsset: trade.counterAsset,
    counterAmount: trade.counterAmount,
    ...(trade.valueUsdMicros === undefined ? {} : { valueUsdMicros: trade.valueUsdMicros }),
    ...(trade.shareSoldBps === undefined ? {} : { shareSoldBps: trade.shareSoldBps }),
    ...(trade.venue === undefined ? {} : { venue: trade.venue }),
  };
}
