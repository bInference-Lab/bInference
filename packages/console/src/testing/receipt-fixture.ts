import type { FakeAnswers } from "./fake-client";

// A paper swap card that waits, then closes once the owner confirms it, with the receipt line the
// engine draws for it then; and a receipt line of each kind the engine's copies end with.

const bnb = "eip155:56/slip44:714";
const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const link = "https://bscscan.com/tx/0xabab";

const amount = (asset: string, base: bigint) => ({ type: "amount", amount: { asset, base } });
const text = (value: string) => ({ type: "text", text: value });
const result = {
  type: "line",
  line: {
    key: "receipt.result",
    values: { sold: amount(bnb, 5n * 10n ** 17n), bought: amount(usdt, 3125n * 10n ** 17n) },
  },
};

// The assets the receipts name.
const receiptAssets = {
  [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
};

/** A receipt line of each kind a closed card ends with, by kind. */
export const receiptLines = {
  paper: { key: "receipt.paper", values: { result } },
  filled: { key: "receipt.filled", values: { result, explorerLink: text(link) } },
  landed: { key: "receipt.landed", values: { explorerLink: text(link) } },
  launched: {
    key: "receipt.launched",
    values: { token: { type: "asset", asset: usdt }, result, explorerLink: text(link) },
  },
  bridgeSent: {
    key: "receipt.bridgeSent",
    values: {
      fromChain: text("BNB Smart Chain"),
      chain: text("Base"),
      minutes: { type: "count", count: 2 },
      explorerLink: text(link),
    },
  },
  bridgeDelivered: {
    key: "receipt.bridgeDelivered",
    values: {
      chain: text("Base"),
      recipient: text("0x4444…0001"),
      received: amount(usdt, 50n * 10n ** 18n),
      explorerLink: text(link),
    },
  },
  bridgeRefunded: {
    key: "receipt.bridgeRefunded",
    values: {
      venue: text("Relay"),
      amount: amount(usdt, 50n * 10n ** 18n),
      wallet: text("main"),
      explorerLink: text(link),
    },
  },
  unstaked: {
    key: "receipt.unstaked",
    values: {
      amount: amount(bnb, 10n ** 18n),
      readyAt: { type: "dateTime", atMs: 1_800_604_800_000 },
      explorerLink: text(link),
    },
  },
  identity: { key: "receipt.identity", values: { agentId: text("42"), explorerLink: text(link) } },
  denied: { key: "receipt.denied", values: { surface: { type: "choice", choice: "telegram" } } },
} as const;

const lines = {
  card,
  version: 1,
  expiresAt: 1_800_000_060_000,
  assets: receiptAssets,
  lines: [
    {
      key: "card.swap.action",
      values: { in: amount(bnb, 5n * 10n ** 17n), minOut: amount(usdt, 3124n * 10n ** 17n) },
    },
  ],
};

const view = {
  intent,
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  kind: "swap",
  paper: true,
  card: { card, version: 1, opensAt: 1_800_000_000_000, expiresAt: 1_800_000_060_000 },
  assets: receiptAssets,
};

/**
 * A fake engine whose card waits until the owner confirms it, then ends with `receipt`, as
 * `intent/get` reads it.
 */
export function closingAnswers(receipt: object): FakeAnswers {
  const state = { isWaiting: true };
  return {
    "intent/list": () => ({
      items: state.isWaiting ? [{ ...view, state: "awaiting_confirmation" }] : [],
    }),
    "intent/card": () => lines,
    "intent/confirm": () => {
      state.isWaiting = false;
      return { ...view, state: "paper_filled", receipt };
    },
    "intent/get": () => ({ ...view, state: "paper_filled", receipt }),
  };
}
