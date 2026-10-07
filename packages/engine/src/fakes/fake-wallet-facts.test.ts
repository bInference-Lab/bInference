import type { AccountRef } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { walletFactsSourceContract } from "../contracts/wallet-facts-source-contract.js";
import { createFakeWalletFacts } from "./fake-wallet-facts.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"agt">;
const stranger = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"agt">;
const wallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"wal">;
const second = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"wal">;
const account = "fake:1:0x0000000c" as AccountRef;
const facts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [{ atMs: 1_000, valueUsdMicros: 5_000_000n }],
};

describe("fake wallet facts", () => {
  it.each(
    walletFactsSourceContract({
      create: () => ({
        source: createFakeWalletFacts(new Map([[agent, [wallet, second]]]), facts),
        agent,
        wallet,
        account,
        stranger,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers the facts it was given for any wallet", async () => {
    const source = createFakeWalletFacts(new Map(), facts);
    const query = { agent, wallet: second, account, isPaper: false };
    await expect(source.facts(query, { signal: new AbortController().signal })).resolves.toBe(
      facts,
    );
  });
});
