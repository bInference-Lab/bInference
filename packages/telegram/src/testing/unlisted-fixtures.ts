import { bpsSchema, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { type OrderView, type PortfolioView, protocolIdSchema } from "@binference/protocol";
import { accountRef, refs } from "./card-fixtures.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000b1");
const order = protocolIdSchema("autoOrder").parse("ord_0190f1c2-3a4b-7c5d-8e6f-0000000000c1");
const atMs = Date.UTC(2026, 9, 10, 9, 30, 0);
const twoTokens = 2n * 10n ** 18n;
const address = accountRef("fake:1:0x00000000000000000000000000000000000000a1");

// What PEPE's proposal stored of it: the registry does not list it.
const assets = { [refs.pepe]: { symbol: "PEPE", name: "Pepe", decimals: 18, verified: false } };

const portfolio: PortfolioView = {
  balances: [{ wallet, amount: { asset: refs.pepe, base: twoTokens }, paper: false }],
  positions: [
    {
      wallet,
      asset: refs.pepe,
      quantity: twoTokens,
      costUsdMicros: 5_000_000n,
      realizedUsdMicros: 0n,
      paper: false,
    },
  ],
  totalUsdMicros: 0n,
  assets,
};

const stopLoss: OrderView = {
  order,
  agent,
  wallet,
  kind: "stopLoss",
  state: "active",
  request: {
    agent,
    kind: "stopLoss",
    token: refs.pepe,
    side: "sell",
    size: { percentBps: bpsSchema.parse(10_000) },
    trigger: { price: 550_000_000n },
  },
  fills: 0,
  expiresAt: atMs,
  createdAt: atMs,
  changedAt: atMs,
};

/**
 * `portfolio/get`, `order/list` and `wallet/list` as the engine answers them for a live wallet,
 * `main`, that holds 2 PEPE,
 * a token the registry does not list, with a stop-loss on it: each names PEPE by what its
 * proposal stored of it, unverified.
 */
export const unlistedHandlers: Pick<
  OwnerChatHandlers,
  "portfolio/get" | "order/list" | "wallet/list"
> = {
  "portfolio/get": async () => Promise.resolve(ok(portfolio)),
  "order/list": async () => Promise.resolve(ok({ items: [stopLoss], assets })),
  "wallet/list": async () =>
    Promise.resolve(ok({ items: [{ wallet, agent, address, label: "main", createdAt: atMs }] })),
};
