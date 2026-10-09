import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMissingParts } from "./missing-parts.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
const wallet = idSchema("wal").parse(`wal_${uuid}`);
const agent = idSchema("agt").parse(`agt_${uuid}`);
const intent = idSchema("int").parse(`int_${uuid}`);
const account = accountRefSchema.parse("eip155:56:0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const stopped = (): { readonly signal: AbortSignal } => ({
  signal: AbortSignal.abort(new Error("stopped")),
});

describe("the missing parts", () => {
  const parts = createMissingParts();

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
    await expect(parts.wallets.balances({ account, assets: [] }, live())).rejects.toMatchObject({
      code: "wallet.custody_down",
      details: { missing: "wallets" },
    });
    await expect(parts.simulator.simulate(intent, {} as never, live())).rejects.toMatchObject({
      code: "chain.simulation_failed",
      details: { missing: "simulator" },
    });
    await expect(parts.txSimulator.simulate([], live())).rejects.toMatchObject({
      code: "chain.simulation_failed",
      details: { missing: "simulator" },
    });
    expect(parts.missing).toStrictEqual(["prices", "wallets", "simulator", "positions"]);
  });

  it("stores no position", async () => {
    await expect(parts.positions.positions({} as never, live())).rejects.toMatchObject({
      code: "internal.error",
      details: { missing: "positions" },
    });
    await expect(parts.positions.resetPaper({} as never, live())).rejects.toMatchObject({
      details: { missing: "positions" },
    });
    await expect(parts.positions.recordDepartures({} as never, live())).rejects.toMatchObject({
      details: { missing: "positions" },
    });
  });

  it("answers nothing on an aborted signal", async () => {
    await expect(parts.prices.usdPrice({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.wallets.wallets(agent, stopped())).rejects.toThrow("stopped");
    await expect(parts.wallets.facts({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.wallets.balances({} as never, stopped())).rejects.toThrow("stopped");
    await expect(parts.simulator.simulate(intent, {} as never, stopped())).rejects.toThrow(
      "stopped",
    );
    await expect(parts.txSimulator.simulate([], stopped())).rejects.toThrow("stopped");
  });
});
