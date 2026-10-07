import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { WalletFactsSource } from "../ports.js";
import { assertRefusesAborted, live } from "./store-fixtures.js";

/** A wallet facts source under test, an agent it knows with its default wallet, and a stranger. */
export interface WalletFactsSourceSubject {
  readonly source: WalletFactsSource;
  readonly agent: Id<"agt">;
  /** The agent's default wallet, with its account on the intent's chain. */
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  /** An agent the source holds no wallet for. */
  readonly stranger: Id<"agt">;
}

/** Makes a fresh {@link WalletFactsSourceSubject} for each check. */
export interface WalletFactsSourceHarness {
  create(): WalletFactsSourceSubject;
}

/** The contract every `WalletFactsSource` adapter passes. */
export function walletFactsSourceContract(
  harness: WalletFactsSourceHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "lists the agent's wallets with its default first",
      run: async () => {
        const { source, agent, wallet } = harness.create();
        assert.equal((await source.wallets(agent, live()))[0], wallet);
      },
    },
    {
      name: "lists no wallet for an agent it does not know",
      run: async () => {
        const { source, stranger } = harness.create();
        assert.deepEqual(await source.wallets(stranger, live()), []);
      },
    },
    {
      name: "answers the facts of a wallet in both modes, none of them negative",
      run: async () => {
        const { source, agent, wallet, account } = harness.create();
        const modes = [true, false].map(async (isPaper) =>
          source.facts({ agent, wallet, account, isPaper }, live()),
        );
        for (const facts of await Promise.all(modes)) {
          assert.ok(facts.nativeBalanceBase >= 0n && facts.ceilingPerTxNativeBase >= 0n);
          assert.ok(facts.feePerGasNativeBase >= 0n && facts.networkFeeCapNativeBase >= 0n);
          assert.ok(facts.recentOutflows.every((outflow) => outflow.valueUsdMicros >= 0n));
        }
      },
    },
    {
      name: "refuses to read on an aborted signal",
      run: async () => {
        const { source, agent, wallet, account } = harness.create();
        await assertRefusesAborted(async (options) => source.wallets(agent, options));
        await assertRefusesAborted(async (options) =>
          source.facts({ agent, wallet, account, isPaper: true }, options),
        );
      },
    },
  ];
}
