import type { WalletRole } from "@binference/chain";
import { err, idSchema, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryInstallStore } from "../fakes/memory-install-store.js";
import type { WalletRecord } from "../install/install-record.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { bridgeWalletOf } from "./bridge-wallet-of.js";

const live = { signal: new AbortController().signal };
const walletId = (n: number) =>
  idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c${String(n)}`);
const main = testWalletRecord({
  id: walletId(1),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs,
});
const bridge = testWalletRecord({
  id: walletId(2),
  agentId: testAgent,
  label: "bridge",
  createdAtMs: testNowMs + 1,
  role: "bridge",
});
const deposit = { type: "function", name: "depositErc20", inputs: [] };
// A host where `relay` marks its deposit a bridge wallet's and `across` marks none.
const host = {
  roleWalletCalls: (role: WalletRole, venues?: readonly string[]) =>
    role === "bridge" && venues?.includes("relay") === true ? [deposit] : [],
};

function picking(wallets: readonly WalletRecord[] = [main, bridge]) {
  const install = createMemoryInstallStore();
  wallets.forEach((wallet) => install.addWallet(wallet));
  return { install, host };
}

describe("the wallet a bridge route leaves from", () => {
  it("is the bridge wallet for a route only a bridge wallet may deposit into", async () => {
    expect(
      await bridgeWalletOf(picking(), { agent: testAgent, venue: "relay" }, live),
    ).toStrictEqual(ok(bridge.id));
    const named = { agent: testAgent, venue: "relay", wallet: bridge.id };
    expect(await bridgeWalletOf(picking(), named, live)).toStrictEqual(ok(bridge.id));
  });

  it("refuses that route from a main wallet before any card", async () => {
    const fromMain = { agent: testAgent, venue: "relay", wallet: main.id };

    expect(await bridgeWalletOf(picking(), fromMain, live)).toStrictEqual(
      err("intent.bridge_wallet_only"),
    );
  });

  it("refuses that route when the agent has no bridge wallet, whichever wallet it names", async () => {
    const mainOnly = picking([main]);

    expect(
      await bridgeWalletOf(mainOnly, { agent: testAgent, venue: "relay" }, live),
    ).toStrictEqual(err("intent.bridge_wallet_missing"));
    const named = { agent: testAgent, venue: "relay", wallet: main.id };
    expect(await bridgeWalletOf(mainOnly, named, live)).toStrictEqual(
      err("intent.bridge_wallet_missing"),
    );
  });

  it("never sends another route from the bridge wallet", async () => {
    const fromBridge = { agent: testAgent, venue: "across", wallet: bridge.id };

    expect(await bridgeWalletOf(picking(), fromBridge, live)).toStrictEqual(
      err("intent.bridge_wallet_only"),
    );
    expect(
      await bridgeWalletOf(picking(), { agent: testAgent, venue: "across" }, live),
    ).toStrictEqual(ok(undefined));
    const fromMain = { agent: testAgent, venue: "across", wallet: main.id };
    expect(await bridgeWalletOf(picking(), fromMain, live)).toStrictEqual(ok(main.id));
  });
});
