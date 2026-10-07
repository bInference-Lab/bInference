import { type AccountRef, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { walletFactsSourceContract } from "../contracts/wallet-facts-source-contract.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { testAgent, testCoin, testWallet } from "../intents/test-intents.js";
import type { PaperPortfolio } from "./paper-portfolio.js";
import { withPaperBalances } from "./paper-wallet-facts.js";

const live = { signal: new AbortController().signal };
const stranger = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
const account = "fake:1:0x0000000c" as AccountRef;
const elsewhere = "fake:2:0x0000000c" as AccountRef;
const facts = {
  nativeBalanceBase: 7n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};
const chains = createChainRegistry({
  chains: [createFakeChainDefinition()],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
// A paper portfolio of 5 units of the fake chain's coin in the test wallet.
const portfolio: PaperPortfolio = {
  balance: async (wallet, asset) =>
    await Promise.resolve(wallet === testWallet && asset === testCoin ? 5n : 0n),
  reset: async () => await Promise.reject(new Error("Not reset here.")),
};
const source = withPaperBalances(
  createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), facts),
  {
    portfolio,
    chains,
  },
);

describe("wallet facts with paper balances", () => {
  it.each(
    walletFactsSourceContract({
      create: () => ({ source, agent: testAgent, wallet: testWallet, account, stranger }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a paper intent's native balance from the paper portfolio only", async () => {
    const query = { agent: testAgent, wallet: testWallet, account };
    const [paper, real] = await Promise.all([
      source.facts({ ...query, isPaper: true }, live),
      source.facts({ ...query, isPaper: false }, live),
    ]);
    expect([paper, real]).toStrictEqual([{ ...facts, nativeBalanceBase: 5n }, facts]);
  });

  it("holds nothing on paper on a chain the registry does not hold", async () => {
    const query = { agent: testAgent, wallet: testWallet, account: elsewhere, isPaper: true };
    expect((await source.facts(query, live)).nativeBalanceBase).toBe(0n);
  });
});
