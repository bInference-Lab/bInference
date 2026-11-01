import type { BuildRequest, TxDraft } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { relayDeclaration } from "./relay-bridge.js";
import { createRelayVenue } from "./relay-venue.js";
import { bsc, tokens, wallet } from "./testing/bridge-fixtures.js";

const live = { signal: new AbortController().signal };

describe("the Relay venue", () => {
  it("declares exactly what the bridge declares", () => {
    const venue = createRelayVenue([bsc]);
    expect({ id: venue.id, contracts: venue.contracts }).toStrictEqual(relayDeclaration([bsc]));
  });

  it("trades nothing: no route, no build and no call it decodes", async () => {
    const venue = createRelayVenue([bsc]);
    const trade = {
      wallet,
      amountIn: { asset: tokens.usdc, base: 10n ** 18n },
      assetOut: tokens.usdt,
      contracts: {},
    };
    await expect(venue.quote(trade, live)).resolves.toStrictEqual({ ok: false, error: "no_route" });
    await expect(venue.build({} as BuildRequest, live)).rejects.toMatchObject({
      code: "relay.no_trade",
    });
    expect(venue.decode({} as TxDraft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
