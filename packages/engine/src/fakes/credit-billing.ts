import type { Id } from "@binference/core";
import type { ModelBilling } from "../ports.js";

/** One owner's prepaid credit, and the agents it pays for. */
export interface CreditAccount {
  /** Micro-dollars of credit at the start. */
  readonly credit: bigint;
  readonly agents: readonly Id<"agt">[];
}

/**
 * Creates a {@link ModelBilling} for tests, shaped like prepaid AI credit: each owner holds one
 * balance that every agent of theirs spends from, and it never renews by itself. An agent no
 * account pays for has nothing to spend.
 */
export function createCreditBilling(accounts: readonly CreditAccount[]): ModelBilling {
  const purses = new Map<Id<"agt">, { balance: bigint }>();
  for (const account of accounts) {
    const purse = { balance: account.credit };
    for (const agent of account.agents) {
      purses.set(agent, purse);
    }
  }
  return {
    async left(agent, options) {
      options.signal.throwIfAborted();
      return await Promise.resolve(purses.get(agent)?.balance ?? 0n);
    },
    async charge(charge, options) {
      options.signal.throwIfAborted();
      const purse = purses.get(charge.agent) ?? { balance: 0n };
      const after = purse.balance - charge.usdMicros;
      purse.balance = after > 0n ? after : 0n;
      return await Promise.resolve(purse.balance);
    },
  };
}
