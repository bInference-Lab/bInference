import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { messages } from "@binference/i18n";
import { parseMessage } from "@binference/i18n/check";
import { describe, expect, it } from "vitest";
import { actionLine, actionVerb, type CardAction } from "./card-action.js";
import type { CardLine } from "./card-line.js";

const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const wallet = "fake:1:saved" as AccountRef;
const validator = "fake:1:validator" as AccountRef;
const half = { asset: coin, base: 5n * 10n ** 17n };
const out = { asset: token, base: 312_400_000n };
const hf = { numerator: 185n, denominator: 100n };

// One action of every kind and move, with the key and the verb each one shows.
const actions: readonly (readonly [CardAction, string, string])[] = [
  [{ kind: "swap", amountIn: half, minOut: out }, "card.swap.action", "swap"],
  [{ kind: "buy", token, spend: half, place: { pool: "PancakeSwap" } }, "card.buy.action", "buy"],
  [
    { kind: "sell", amount: out, minOut: half, place: { curve: "Flap" } },
    "card.sell.action",
    "sell",
  ],
  [{ kind: "send", amount: half, recipient: wallet }, "card.send.action", "send"],
  [{ kind: "revokeApproval", token, spender: wallet }, "card.revoke.action", "revoke"],
  [
    { kind: "lend", action: "supply", amount: half, venue: "Venus", healthFactor: hf },
    "card.lend.supply",
    "supply",
  ],
  [
    { kind: "lend", action: "repay", amount: half, venue: "Venus", healthFactor: hf },
    "card.lend.repay",
    "repay",
  ],
  [{ kind: "stake", action: "stake", amount: half, validator }, "card.stake.stake", "stake"],
  [
    { kind: "stake", action: "unstake", amount: half, validator, readyInDays: 7 },
    "card.stake.unstake",
    "unstake",
  ],
  [{ kind: "stake", action: "claim", amount: half, validator }, "card.stake.claim", "claim"],
  [
    {
      kind: "bridge",
      amount: half,
      chain: "fake:2" as ChainRef,
      recipient: wallet,
      minutes: 3,
    },
    "card.bridge.action",
    "bridge",
  ],
  [
    { kind: "cexOrder", side: "buy", size: "0.5", market: "BNBUSDT", price: "612.5" },
    "card.cex.action",
    "order",
  ],
  [{ kind: "registerIdentity", agent: "main" }, "card.identity.action", "register"],
  [
    {
      kind: "launchToken",
      symbol: "CAT",
      name: "Cat",
      venue: "Flap",
      pair: coin,
      firstBuy: half,
    },
    "card.launch.action",
    "launch",
  ],
  [
    {
      kind: "rescue",
      address: wallet,
      tokenCount: 4,
      walletCount: 2,
      valueUsdMicros: 912_000_000n,
    },
    "card.rescue.action",
    "rescue",
  ],
];

// The names of a message's arguments, in English, without their ICU forms.
function argumentNames(line: CardLine): readonly string[] {
  const parsed = parseMessage(messages.en[line.key] ?? "");
  const forms = parsed.ok ? parsed.value.arguments : [];
  return forms.map((form) => form.replace(/^\{([^,}]+).*$/, "$1")).toSorted();
}

describe("action lines", () => {
  it("draws each kind's line under the key spec 4 gives it", () => {
    expect(actions.map(([action]) => actionLine(action).key)).toStrictEqual(
      actions.map(([, key]) => key),
    );
  });

  it("gives each line exactly the arguments its message names", () => {
    const lines = actions.map(([action]) => actionLine(action));
    expect(lines.map((line) => Object.keys(line.values).toSorted())).toStrictEqual(
      lines.map((line) => argumentNames(line)),
    );
  });

  it("types every value so a surface can format it", () => {
    const types = actions.map(([action]) =>
      Object.values(actionLine(action).values).map((value) => value.type),
    );
    expect(types).toStrictEqual([
      ["amount", "amount"],
      ["asset", "amount", "text"],
      ["amount", "amount", "line"],
      ["amount", "account"],
      ["account", "asset"],
      ["amount", "text", "ratio"],
      ["amount", "text", "ratio"],
      ["amount", "account"],
      ["amount", "account", "count"],
      ["amount", "account"],
      ["amount", "chain", "account", "count"],
      ["choice", "text", "text", "text"],
      ["text"],
      ["text", "text", "text", "asset", "amount"],
      ["account", "count", "count", "usd"],
    ]);
  });

  it("names the verb of each kind and of each lend or stake move", () => {
    expect(actions.map(([action]) => actionVerb(action))).toStrictEqual(
      actions.map(([, , verb]) => verb),
    );
  });

  it("draws a swap from its amounts in base units", () => {
    expect(actionLine({ kind: "swap", amountIn: half, minOut: out })).toStrictEqual({
      key: "card.swap.action",
      values: { in: { type: "amount", amount: half }, minOut: { type: "amount", amount: out } },
    });
  });

  it("names a curve through its own message and a pool by its venue", () => {
    const onCurve = actionLine({ kind: "buy", token, spend: half, place: { curve: "Flap" } });
    const inPool = actionLine({ kind: "buy", token, spend: half, place: { pool: "PancakeSwap" } });
    expect(onCurve.values["place"]).toStrictEqual({
      type: "line",
      line: { key: "card.place.curve", values: { launchpad: { type: "text", text: "Flap" } } },
    });
    expect(inPool.values["place"]).toStrictEqual({ type: "text", text: "PancakeSwap" });
  });

  it("counts the days an unstake waits and the tokens and wallets a rescue moves", () => {
    const unstake = actionLine({
      kind: "stake",
      action: "unstake",
      amount: half,
      validator,
      readyInDays: 7,
    });
    const rescue = actionLine({
      kind: "rescue",
      address: wallet,
      tokenCount: 4,
      walletCount: 2,
      valueUsdMicros: 912_000_000n,
    });
    expect(unstake.values["days"]).toStrictEqual({ type: "count", count: 7 });
    expect([rescue.values["count"], rescue.values["wallets"], rescue.values["usd"]]).toStrictEqual([
      { type: "count", count: 4 },
      { type: "count", count: 2 },
      { type: "usd", usdMicros: 912_000_000n },
    ]);
  });
});
