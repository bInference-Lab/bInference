import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { readPrivyCall } from "./evm-transaction.schema.js";

const signTransaction = (transaction: JsonValue): JsonValue => ({
  method: "eth_signTransaction",
  params: { transaction },
});

describe("reading Privy's eth_signTransaction body", () => {
  it("reads every field Privy takes, with addresses and calldata in lowercase", () => {
    expect(
      readPrivyCall(
        signTransaction({
          to: "0x13F4EA83D0bd40E75C8222255bc855a974568Dd4",
          value: "0x2386F26FC10000",
          chain_id: 56,
          data: "0xABCDEF",
          nonce: "0x7",
          type: 2,
          gas_limit: 21_000,
          max_fee_per_gas: 1_000_308,
          max_priority_fee_per_gas: "0x0",
        }),
      ),
    ).toStrictEqual({
      kind: "transaction",
      transaction: {
        chainId: 56n,
        to: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4",
        value: 10n ** 16n,
        data: "0xabcdef",
        nonce: 7n,
        feePerGas: 1_000_308n,
        type: 2,
        delegates: false,
      },
    });
  });

  it("gives no value 0, no calldata 0x, and leaves out what the body leaves out", () => {
    expect(readPrivyCall(signTransaction({ nonce: 0 }))).toStrictEqual({
      kind: "transaction",
      transaction: { value: 0n, data: "0x", nonce: 0n, delegates: false },
    });
  });

  it("takes the larger fee when a transaction names both", () => {
    const both = readPrivyCall(signTransaction({ nonce: 1, gas_price: 9, max_fee_per_gas: 4 }));
    const legacy = readPrivyCall(signTransaction({ nonce: 1, gas_price: 3 }));

    expect([both, legacy]).toMatchObject([
      { transaction: { feePerGas: 9n } },
      { transaction: { feePerGas: 3n } },
    ]);
  });

  it("marks an EIP-7702 authorization list", () => {
    expect(readPrivyCall(signTransaction({ nonce: 1, authorization_list: [{}] }))).toMatchObject({
      transaction: { delegates: true },
    });
  });

  it("reads the body Privy's Node SDK sends, which names the chain type", () => {
    expect(
      readPrivyCall({ ...(signTransaction({ nonce: 3 }) as object), chain_type: "ethereum" }),
    ).toStrictEqual({
      kind: "transaction",
      transaction: { value: 0n, data: "0x", nonce: 3n, delegates: false },
    });
  });

  it.each([
    ["personal_sign", { method: "personal_sign", params: { message: "hi" } }],
    ["typed data", { method: "eth_signTypedData_v4", params: { typed_data: {} } }],
  ])("tells a body of %s from a transaction", (_case, body) => {
    expect(readPrivyCall(body)).toStrictEqual({ kind: "otherMethod" });
  });

  it.each([
    ["a body that is no object", "eth_signTransaction"],
    [
      "a body with another field",
      { method: "eth_signTransaction", params: {}, caip2: "eip155:56" },
    ],
    [
      "a chain type other than Ethereum",
      { ...(signTransaction({ nonce: 1 }) as object), chain_type: "solana" },
    ],
    ["params with no transaction", { method: "eth_signTransaction", params: {} }],
    ["no nonce", signTransaction({ to: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4" })],
    ["a sender", signTransaction({ nonce: 1, from: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4" })],
    ["a quantity in decimal text", signTransaction({ nonce: 1, value: "1000" })],
    ["a negative quantity", signTransaction({ nonce: -1 })],
    ["empty hex", signTransaction({ nonce: "0x" })],
    ["an address of 19 bytes", signTransaction({ nonce: 1, to: `0x${"1".repeat(38)}` })],
    ["calldata of half a byte", signTransaction({ nonce: 1, data: "0xabc" })],
    ["a transaction type Privy does not take", signTransaction({ nonce: 1, type: 3 })],
  ])("cannot read %s", (_case, body) => {
    expect(readPrivyCall(body)).toStrictEqual({ kind: "unreadable" });
  });
});
