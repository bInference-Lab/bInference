import type { ContractCheck } from "@binference/core/testing";
import type { PrivyCustodyHarness, PrivyCustodySubject } from "./privy-custody-setup.js";

/** How a group of checks makes its wallets, once per subject, and where it keeps them. */
export interface SharedWallets<Wallets> {
  readonly made: WeakMap<PrivyCustodySubject, Promise<Wallets>>;
  readonly make: (subject: PrivyCustodySubject) => Promise<Wallets>;
}

/**
 * A contract check run on wallets made once per subject and shared by every check of the group,
 * so a live app gets each group's wallets once in a run.
 */
export function sharedWalletsCheck<Wallets>(
  harness: PrivyCustodyHarness,
  wallets: SharedWallets<Wallets>,
  check: { readonly name: string; readonly run: (made: Wallets) => Promise<void> },
): ContractCheck {
  return {
    name: check.name,
    run: async () => {
      const subject = harness.create();
      const made = wallets.made.get(subject) ?? wallets.make(subject);
      wallets.made.set(subject, made);
      await check.run(await made);
    },
  };
}
