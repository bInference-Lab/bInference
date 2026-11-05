import { accountRefSchema } from "@binference/chain";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { InstallFacts } from "../install/install-record.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testChains } from "../operations/test-engine.js";
import { isInstallAccount } from "./install-accounts.js";

const live = new AbortController().signal;
const wallet = testWalletRecord({
  id: fixtureId("wal", 2),
  agentId: fixtureId("agt", 2),
  label: "B",
  createdAtMs: 0,
});

// The install holding the one wallet, with custody locked: it knows no account.
const locked = {
  install: { read: async () => Promise.resolve({ wallets: [wallet] } as unknown as InstallFacts) },
  custody: { account: async () => Promise.resolve(err("unknown_wallet" as const)) },
  chains: testChains(),
};

describe("whether an account is a wallet of the install", () => {
  it("knows a wallet by the address the install keeps while custody is locked", async () => {
    const kept = accountRefSchema.parse(`fake:1:${wallet.address}`);
    const other = accountRefSchema.parse("fake:1:0x00000009");

    expect(await isInstallAccount(locked, kept, live)).toBe(true);
    expect(await isInstallAccount(locked, other, live)).toBe(false);
  });

  it("knows a wallet by the account custody holds on a chain the registry does not list", async () => {
    const elsewhere = accountRefSchema.parse("fake:9:0x000000a9");
    const held = { ...locked, custody: { account: async () => Promise.resolve(ok(elsewhere)) } };
    expect(await isInstallAccount(held, elsewhere, live)).toBe(true);
    expect(await isInstallAccount(locked, elsewhere, live)).toBe(false);
  });

  it("reads no kept address of a wallet of another family", async () => {
    const other = { ...wallet, family: "other" };
    const install = {
      read: async () => Promise.resolve({ wallets: [other] } as unknown as InstallFacts),
    };
    const kept = accountRefSchema.parse(`fake:1:${wallet.address}`);
    expect(await isInstallAccount({ ...locked, install }, kept, live)).toBe(false);
  });
});
