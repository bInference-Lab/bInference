import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMissingParts } from "./missing-parts.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
const wallet = idSchema("wal").parse(`wal_${uuid}`);
const agent = idSchema("agt").parse(`agt_${uuid}`);
const intent = idSchema("int").parse(`int_${uuid}`);
const chain = chainRefSchema.parse("eip155:56");
const account = accountRefSchema.parse("eip155:56:0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const stopped = (): { readonly signal: AbortSignal } => ({
  signal: AbortSignal.abort(new Error("stopped")),
});

describe("the missing parts", () => {
  const parts = createMissingParts();

  it("holds no wallet and signs nothing", async () => {
    await expect(parts.custody.account(wallet, chain, live())).resolves.toStrictEqual({
      ok: false,
      error: "unknown_wallet",
    });
    const request = {
      wallet,
      intent,
      authorization: { approvalMode: "auto", modeVersion: 1 },
      tx: { chain, from: account, payload: "0x" },
    } as const;
    await expect(parts.custody.signTransaction(request as never, live())).resolves.toStrictEqual({
      ok: false,
      error: "refused",
    });
  });

  it("prices nothing, so the policy refuses every trade", async () => {
    const coin = assetRefSchema.parse("eip155:56/slip44:714");
    await expect(parts.prices.usdPrice(coin, live())).resolves.toStrictEqual({
      ok: false,
      error: "no_price",
    });
  });

  it("gives no agent a wallet and refuses to make up wallet facts or a simulation", async () => {
    await expect(parts.wallets.wallets(agent, live())).resolves.toStrictEqual([]);
    await expect(
      parts.wallets.facts({ agent, wallet, account, isPaper: true }, live()),
    ).rejects.toMatchObject({ code: "wallet.custody_down", details: { missing: "wallets" } });
    await expect(parts.simulator.simulate(intent, {} as never, live())).rejects.toMatchObject({
      code: "chain.simulation_failed",
      details: { missing: "simulator" },
    });
    expect(parts.missing).toStrictEqual([
      "custody",
      "prices",
      "wallets",
      "simulator",
      "network",
      "positions",
    ]);
  });

  it("reaches no host and stores no position", async () => {
    const request = { method: "POST", url: "https://rpc.48.club", signal: live().signal } as const;
    await expect(parts.http.request(request)).rejects.toMatchObject({
      code: "http.unreachable",
      retryable: true,
      details: { missing: "network" },
    });
    await expect(parts.positions.positions({} as never, live())).rejects.toMatchObject({
      code: "internal.error",
      details: { missing: "positions" },
    });
    await expect(parts.positions.resetPaper({} as never, live())).rejects.toMatchObject({
      details: { missing: "positions" },
    });
  });

  it("answers nothing on an aborted signal", async () => {
    await expect(parts.custody.account(wallet, chain, stopped())).rejects.toThrow("stopped");
    await expect(parts.custody.signTransaction({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.prices.usdPrice({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.wallets.wallets(agent, stopped())).rejects.toThrow("stopped");
    await expect(parts.wallets.facts({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.simulator.simulate(intent, {} as never, stopped())).rejects.toThrow(
      "stopped",
    );
    const request = { method: "GET", url: "https://rpc.48.club", ...stopped() } as const;
    await expect(parts.http.request(request)).rejects.toThrow("stopped");
  });
});
