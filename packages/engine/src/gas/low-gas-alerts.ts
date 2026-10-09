import { type AccountRef, accountRefParts, type AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import { policyLimitsOf } from "../money-path/policy-facts-of.js";
import type { ResolvedProposal } from "../money-path/resolve-proposal.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the low-gas alert (spec 4, section 4). */
export const lowGasNoticeKey = "notice.lowGas";

/** What the money path read about a live wallet's native coin as it checked an intent. */
export interface GasReading {
  readonly agent: Id<"agt">;
  readonly wallet: Id<"wal">;
  /** The wallet's account on the chain the balance is on. */
  readonly account: AccountRef;
  readonly nativeAsset: AssetRef;
  readonly balanceBase: bigint;
  /** The native coin the wallet keeps for network fees on that chain. */
  readonly reserveBase: bigint;
}

/**
 * Tells the owner when a live wallet runs low on gas (decision 0045): below twice its reserve,
 * trades soon stop, since the policy never lets one spend the reserve.
 */
export interface LowGasAlerts {
  /**
   * Announces the `notice.lowGas` notice when the balance is below twice the reserve, once until
   * a reading shows it at or above that again. It never throws: an alert never blocks a trade.
   */
  check(reading: GasReading): void;
}

// One entry per wallet and chain the engine read low; past this many, the oldest is forgotten,
// which at worst repeats its alert.
const maxLowWallets = 1_000;

/** Creates the {@link LowGasAlerts}, which hold what they announced in memory only. */
export function createLowGasAlerts(options: { readonly publish: PublishPush }): LowGasAlerts {
  const low = new Set<string>();
  return {
    check(reading) {
      const key = `${reading.wallet} ${reading.account}`;
      if (reading.balanceBase >= 2n * reading.reserveBase) {
        low.delete(key);
        return;
      }
      if (low.has(key)) {
        return;
      }
      if (low.size >= maxLowWallets) {
        low.delete(low.values().next().value ?? key);
      }
      low.add(key);
      options.publish(
        noticePush({
          key: lowGasNoticeKey,
          agent: reading.agent,
          values: { wallet: accountRefParts(reading.account).address },
          amounts: { balance: { asset: reading.nativeAsset, base: reading.balanceBase } },
        }),
      );
    },
  };
}

/** The gas reading of a resolved proposal: its wallet's native balance and reserve. */
export function gasReadingOf(resolved: ResolvedProposal): GasReading {
  const { settings, wallet, account, chain, nativeAsset, facts } = resolved;
  return {
    agent: settings.agent.id,
    wallet,
    account,
    nativeAsset,
    balanceBase: facts.nativeBalanceBase,
    reserveBase: policyLimitsOf(settings.limits, chain.ref).gasReserveBase,
  };
}
