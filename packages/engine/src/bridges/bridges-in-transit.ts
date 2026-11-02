import type { AccountRef, Amount, ChainRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { IntentStore } from "../ports.js";
import { type BridgeCursor, type BridgeRecord, openBridgeStates } from "./bridge-record.js";
import type { BridgeStore } from "./ports.js";

/**
 * A bridge in transit or late, as the portfolio counts it (decision 0329): what left the wallet, at
 * the value its units left their position with, until a read settles it.
 */
export interface TransitHolding {
  readonly intentId: Id<"int">;
  readonly walletId: Id<"wal">;
  readonly amount: Amount;
  readonly usdMicros?: bigint;
  readonly toChain: ChainRef;
  readonly recipient: AccountRef;
  readonly sentAtMs: number;
  readonly late: boolean;
}

/** What the bridges in transit are read from: their rows, and their intents' wallets. */
export interface TransitParts {
  readonly bridges: Pick<BridgeStore, "list">;
  readonly intents: Pick<IntentStore, "get">;
}

// A page of bridges the store reads at once.
const pageSize = 100;

async function openBridges(
  bridges: Pick<BridgeStore, "list">,
  call: { readonly signal: AbortSignal },
): Promise<readonly BridgeRecord[]> {
  const read: BridgeRecord[] = [];
  let after: BridgeCursor | undefined;
  for (;;) {
    const query = {
      states: openBridgeStates,
      limit: pageSize,
      ...(after === undefined ? {} : { after }),
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the one before
    const page = await bridges.list(query, call);
    read.push(...page);
    const last = page.at(-1);
    if (page.length < pageSize || last === undefined) {
      return read;
    }
    after = { sentAtMs: last.sentAtMs, intentId: last.intentId };
  }
}

/**
 * The bridges in transit or late of the wallets named, the oldest deposit first (decision 0329):
 * each bridge's wallet is its intent's. Bridges are live only, so a paper portfolio has none.
 */
export async function bridgesInTransit(
  parts: TransitParts,
  wallets: ReadonlySet<Id<"wal">>,
  call: { readonly signal: AbortSignal },
): Promise<readonly TransitHolding[]> {
  if (wallets.size === 0) {
    return [];
  }
  const open = await openBridges(parts.bridges, call);
  const held = await Promise.all(
    open.map(async (bridge): Promise<readonly TransitHolding[]> => {
      const intent = await parts.intents.get(bridge.intentId, call);
      if (intent === undefined || !wallets.has(intent.walletId)) {
        return [];
      }
      const { valueUsdMicros } = bridge;
      return [
        {
          intentId: bridge.intentId,
          walletId: intent.walletId,
          amount: bridge.sent,
          ...(valueUsdMicros === undefined ? {} : { usdMicros: valueUsdMicros }),
          toChain: bridge.toChain,
          recipient: bridge.recipient,
          sentAtMs: bridge.sentAtMs,
          late: bridge.state === "late",
        },
      ];
    }),
  );
  return held.flat();
}
