import type { UnsignedTx } from "@binference/chain";
import { serializeTransaction } from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import {
  decodeEvmTransaction,
  encodeEvmTransaction,
  type EvmTransaction,
} from "./evm-transaction.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const from = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const to = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

const tx: EvmTransaction = {
  from,
  to,
  value: 10n ** 17n,
  data: "0x7ff36ab5",
  nonce: 7,
  gas: 200_000n,
  fees: { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 50_000_000n },
};

describe("evm transaction", () => {
  it("encodes a type-2 payload for the sender's account and reads it back", () => {
    const unsigned = encodeEvmTransaction(chain, tx);
    expect(unsigned.chain).toBe("eip155:56");
    expect(unsigned.from).toBe(`eip155:56:${from}`);
    expect(unsigned.payload.startsWith("0x02")).toBe(true);
    expect(decodeEvmTransaction(unsigned)).toStrictEqual({
      ok: true,
      value: { ...tx, chainId: 56 },
    });
  });

  it("reads the empty fields of a zero transaction as zeros", () => {
    const zero: EvmTransaction = {
      ...tx,
      value: 0n,
      data: "0x",
      nonce: 0,
      gas: 0n,
      fees: { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n },
    };
    expect(decodeEvmTransaction(encodeEvmTransaction(chain, zero))).toStrictEqual({
      ok: true,
      value: { ...zero, chainId: 56 },
    });
  });

  const unsigned = encodeEvmTransaction(chain, tx);
  const creation = serializeTransaction({ type: "eip1559", chainId: 56, nonce: 1, data: "0x6000" });
  const signed = serializeTransaction(
    { type: "eip1559", chainId: 56, nonce: 1, to },
    { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, yParity: 0 },
  );
  const legacy = serializeTransaction({ type: "legacy", chainId: 56, nonce: 1, gasPrice: 1n, to });

  it.each([
    ["a contract creation", { ...unsigned, payload: creation }],
    ["a signed payload", { ...unsigned, payload: signed }],
    ["a legacy payload", { ...unsigned, payload: legacy }],
    ["text that is not hex", { ...unsigned, payload: "nonsense" }],
    ["bytes that are no transaction", { ...unsigned, payload: "0x02ff" }],
    ["a sender that is no EVM address", { ...unsigned, from: "eip155:56:alice" } as UnsignedTx],
  ])("refuses %s", (_case, item) => {
    expect(decodeEvmTransaction(item)).toStrictEqual({ ok: false, error: "malformed_transaction" });
  });
});
