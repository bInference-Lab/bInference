import { chainRefSchema } from "@binference/chain";
import { arbitrum, baseMainnet, ethereum, robinhood, solana } from "@binference/chains";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { selfHostedDestinationChains } from "./destination-chains.js";
import { baseDelivery, deliveredReceiptText, solanaDelivery } from "./test-delivered-receipt.js";

const refusing = {
  request: async () => Promise.reject(new Error("No network in a unit test.")),
};

describe("the chains a bridge delivers to, as the engine takes them", () => {
  it("names the five destinations, each with its family's codec and account reader", () => {
    const destinations = selfHostedDestinationChains({
      http: refusing,
      clock: createManualClock(),
    });

    expect(destinations.map((item) => item.ref)).toStrictEqual(
      [ethereum, baseMainnet, arbitrum, robinhood, solana].map((item) =>
        chainRefSchema.parse(item.id),
      ),
    );
    expect(destinations.map((item) => item.codec.namespace)).toStrictEqual([
      "eip155",
      "eip155",
      "eip155",
      "eip155",
      "solana",
    ]);
    expect(destinations.map((item) => item.kinds?.chain)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      chainRefSchema.parse(solana.id),
    ]);
    expect(destinations.map((item) => item.codes?.chain)).toStrictEqual([
      ...[ethereum, baseMainnet, arbitrum, robinhood].map((item) => chainRefSchema.parse(item.id)),
      undefined,
    ]);
  });
});

// The icon of spec 4, built from its code point: no emoji sits in code.
const done = String.fromCodePoint(0x2705);

describe("a delivered bridge's receipt", () => {
  it("links a delivery on Base to the registry's explorer there", async () => {
    const { recipient, fill } = baseDelivery;
    await expect(deliveredReceiptText(baseDelivery, "en")).resolves.toBe(
      `${done} Delivered on Base: ${recipient} received 12.5 USDC · https://basescan.org/tx/${fill}`,
    );
  });

  it("links a delivery on Solana to the registry's explorer there", async () => {
    const { recipient, fill } = solanaDelivery;
    await expect(deliveredReceiptText(solanaDelivery, "en")).resolves.toBe(
      `${done} Delivered on Solana: ${recipient} received 12.5 USDC · https://explorer.solana.com/tx/${fill}`,
    );
  });
});
