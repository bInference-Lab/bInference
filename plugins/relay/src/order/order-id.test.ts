import { parseJsonText } from "@binference/plugin-sdk/data";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import base from "../testing/recorded/quote-usdc-base.json" with { type: "json" };
import solana from "../testing/recorded/quote-usdc-solana.json" with { type: "json" };
import robinhood from "../testing/recorded/quote-usdt-robinhood.json" with { type: "json" };
import { orderIdOf } from "./order-id.js";
import { relayOrderSchema } from "./relay-order.schema.js";

const protocolSchema = z.looseObject({
  protocol: z.looseObject({
    v2: z.looseObject({ orderId: z.string(), orderData: z.unknown() }),
  }),
});

// The answer as the bridge reads it: every number kept as the text Relay wrote.
function recordedOrder(answer: unknown) {
  const read = parseJsonText(JSON.stringify(answer));
  const { orderId, orderData } = protocolSchema.parse(read).protocol.v2;
  return { orderId, order: relayOrderSchema.parse(orderData) };
}

describe("a Relay order's id", () => {
  it.each([
    ["Base, an EVM recipient", base],
    ["Solana, a base58 recipient", solana],
    ["Robinhood Chain, USDT arriving as USDG", robinhood],
  ])("is the one Relay's recorded quote to %s names", (_name, answer) => {
    const { orderId, order } = recordedOrder(answer);
    expect(orderIdOf(order)).toBe(orderId);
  });

  it("moves with any term of the order: the recipient, the least output or a refund", () => {
    const { orderId, order } = recordedOrder(base);
    const recipient = { ...order.output, recipient: `0x${"33".repeat(20)}` };
    const less = { ...order.output, minimumAmount: order.output.minimumAmount - 1n };
    const refunds = order.refunds.map((refund) => ({
      ...refund,
      recipient: `0x${"44".repeat(20)}`,
    }));
    expect(orderIdOf({ ...order, output: recipient })).not.toBe(orderId);
    expect(orderIdOf({ ...order, output: less })).not.toBe(orderId);
    expect(orderIdOf({ ...order, refunds })).not.toBe(orderId);
  });

  it("has none for an order naming a chain no listed route touches, or a Solana address as hex", () => {
    const { order } = recordedOrder(solana);
    expect(
      orderIdOf({ ...order, output: { ...order.output, chainId: "optimism" } }),
    ).toBeUndefined();
    const hexOnSolana = { ...order.output, recipient: `0x${"22".repeat(20)}` };
    expect(orderIdOf({ ...order, output: hexOnSolana })).toBeUndefined();
  });
});
