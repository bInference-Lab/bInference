import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import type { BridgeCandidate } from "./bridge-routes.js";
import { bridgeWalletOf } from "./bridge-wallet.js";
import { testRoute } from "./test-bridges.js";

const wallet = (n: number) =>
  idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);
const record = (n: number, role?: "bridge" | "launch") =>
  testWalletRecord({
    id: wallet(n),
    agentId: testAgent,
    label: `w${n}`,
    createdAtMs: testNowMs + n,
    ...(role === undefined ? {} : { role }),
  });
const main = record(1);
const bridgeWallet = record(2, "bridge");
const extraBridge = record(3, "bridge");
const launchWallet = record(4, "launch");
const wallets = [main, bridgeWallet, extraBridge, launchWallet];
const owned = wallets.map((item) => item.id);
const hostedOf = (id: string): BridgeCandidate["hosted"] => ({
  bridge: { id, contracts: [], destinations: [] } as never,
  routes: [],
});
const across: BridgeCandidate = {
  hosted: hostedOf("across"),
  route: testRoute,
  isBridgeWallets: false,
};
const relay: BridgeCandidate = {
  hosted: hostedOf("relay"),
  route: testRoute,
  isBridgeWallets: true,
};
const ask = (candidates: readonly BridgeCandidate[], named?: ReturnType<typeof wallet>) => ({
  wallets,
  owned,
  agent: testAgent,
  candidates,
  ...(named === undefined ? {} : { named }),
});

describe("the wallet a bridge runs from", () => {
  it("takes a main wallet's route from the default wallet when no wallet is named", () => {
    expect(bridgeWalletOf(ask([across, relay]))).toStrictEqual({
      ok: true,
      value: { wallet: main.id, candidates: [across] },
    });
    expect(bridgeWalletOf(ask([]))).toStrictEqual({
      ok: true,
      value: { wallet: main.id, candidates: [] },
    });
  });

  it("takes a bridge venue's route from the bridge wallet, which it needs", () => {
    expect(bridgeWalletOf(ask([relay]))).toStrictEqual({
      ok: true,
      value: { wallet: bridgeWallet.id, candidates: [relay] },
    });
    const without = { ...ask([relay]), wallets: [main] };
    expect(bridgeWalletOf(without)).toStrictEqual({
      ok: false,
      error: "intent.bridge_wallet_missing",
    });
  });

  it("lets the named bridge wallet take only bridge venues' routes", () => {
    expect(bridgeWalletOf(ask([across, relay], bridgeWallet.id))).toStrictEqual({
      ok: true,
      value: { wallet: bridgeWallet.id, candidates: [relay] },
    });
    expect(bridgeWalletOf(ask([across], bridgeWallet.id))).toStrictEqual({
      ok: false,
      error: "intent.bridge_wallet_only",
    });
  });

  it("refuses any other wallet where only bridge venues serve, and an extra wallet always", () => {
    expect(bridgeWalletOf(ask([relay], main.id))).toStrictEqual({
      ok: false,
      error: "intent.bridge_wallet_only",
    });
    expect(bridgeWalletOf(ask([relay], launchWallet.id))).toStrictEqual({
      ok: false,
      error: "intent.bridge_wallet_only",
    });
    expect(bridgeWalletOf(ask([across], extraBridge.id))).toStrictEqual({
      ok: false,
      error: "intent.extra_wallet",
    });
    expect(bridgeWalletOf(ask([across], launchWallet.id))).toStrictEqual({
      ok: true,
      value: { wallet: launchWallet.id, candidates: [across] },
    });
    expect(bridgeWalletOf(ask([across], wallet(9)))).toStrictEqual({
      ok: false,
      error: "wallet.not_found",
    });
  });
});
