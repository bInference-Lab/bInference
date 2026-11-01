import { describe, expect, it } from "vitest";
import { baseDelivery, deliveredReceiptText, solanaDelivery } from "./test-delivered-receipt.js";

// The icon of spec 4, built from its code point: no emoji sits in code.
const done = String.fromCodePoint(0x2705);

describe("a delivered bridge's receipt in Chinese", () => {
  it("links a delivery on Base to the registry's explorer there", async () => {
    const { recipient, fill } = baseDelivery;
    await expect(deliveredReceiptText(baseDelivery, "zh")).resolves.toBe(
      `${done} 已在 Base 到账：${recipient} 收到 12.5 USDC · https://basescan.org/tx/${fill}`,
    );
  });

  it("links a delivery on Solana to the registry's explorer there", async () => {
    const { recipient, fill } = solanaDelivery;
    await expect(deliveredReceiptText(solanaDelivery, "zh")).resolves.toBe(
      `${done} 已在 Solana 到账：${recipient} 收到 12.5 USDC · https://explorer.solana.com/tx/${fill}`,
    );
  });
});
