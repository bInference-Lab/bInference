import { accountRefSchema, chainRefSchema, type SignedTx } from "@binference/chain";
import { signingSchemeContract } from "@binference/chain/testing";
import {
  type Hex,
  hexToBigInt,
  keccak256,
  serializeTransaction,
  type TransactionSerializableEIP1559,
  toHex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import { createEvmSigningScheme } from "./evm-signing-scheme.js";
import type { EvmTransaction } from "./evm-transaction.js";
import { recoverSigner } from "./recover-signer.js";

// Throwaway keys derived from fixed words, so no key is written down anywhere.
const senderKey = keccak256(toHex("binference chain-evm test sender"));
const otherKey = keccak256(toHex("binference chain-evm test other"));
const sender = privateKeyToAccount(senderKey);
const other = privateKeyToAccount(otherKey);
const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const tx: EvmTransaction = {
  from: sender.address,
  to: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  value: 10n ** 17n,
  data: "0x7ff36ab5",
  nonce: 7,
  gas: 200_000n,
  fees: { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 50_000_000n },
};

function fieldsOf(item: EvmTransaction): TransactionSerializableEIP1559 {
  return {
    type: "eip1559",
    chainId: chain.chainId,
    nonce: item.nonce,
    gas: item.gas,
    maxFeePerGas: item.fees.maxFeePerGas,
    maxPriorityFeePerGas: item.fees.maxPriorityFeePerGas,
    to: item.to,
    value: item.value,
    data: item.data,
  };
}

const scheme = createEvmSigningScheme();
const unsigned = scheme.build(chain, tx);
const signedTx = (raw: Hex): SignedTx => ({ chain: unsigned.chain, raw });
const signed: Record<string, SignedTx> = {};

beforeAll(async () => {
  signed["sender"] = signedTx(await sender.signTransaction(fieldsOf(tx)));
  signed["other"] = signedTx(await other.signTransaction(fieldsOf(tx)));
  signed["otherTx"] = signedTx(await sender.signTransaction(fieldsOf({ ...tx, nonce: 8 })));
  signed["legacy"] = signedTx(
    await sender.signTransaction({
      type: "legacy",
      chainId: 56,
      nonce: 7,
      gas: 21_000n,
      gasPrice: 1n,
      to: tx.to,
    }),
  );
});

const get = (name: string): SignedTx => signed[name] ?? signedTx("0x");

async function signHash(hash: Hex): Promise<{ r: Hex; s: Hex; yParity: number }> {
  const { r, s, yParity } = await sign({ hash, privateKey: senderKey });
  return { r, s, yParity: yParity ?? 0 };
}

describe("evm signing scheme", () => {
  it.each(
    signingSchemeContract({
      create: () => ({
        scheme,
        unsigned,
        signed: get("sender"),
        signedByOther: get("other"),
        otherSigned: get("otherTx"),
        malformed: signedTx("0xdeadbeef"),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives the hash the chain shows for the signed transaction", () => {
    expect(scheme.verify(unsigned, get("sender"))).toStrictEqual({
      ok: true,
      value: keccak256(get("sender").raw as Hex),
    });
  });

  it("hashes exactly what the sender's key signs", async () => {
    const hash = keccak256(unsigned.payload as Hex);
    expect(scheme.signingHash(unsigned)).toStrictEqual({ ok: true, value: hash });
    const raw = serializeTransaction(fieldsOf(tx), await signHash(hash));
    expect(raw).toBe(get("sender").raw);
  });

  it("refuses a signing hash for a payload that is no transaction", () => {
    expect(scheme.signingHash({ ...unsigned, payload: "nonsense" })).toStrictEqual({
      ok: false,
      error: "malformed_transaction",
    });
  });

  it.each([
    [
      "the unsigned payload itself",
      (): SignedTx => signedTx(unsigned.payload as Hex),
      "malformed_signature",
    ],
    ["a legacy transaction", (): SignedTx => get("legacy"), "other_transaction"],
    [
      "a signature for another chain",
      (): SignedTx => ({ chain: chainRefSchema.parse("eip155:1"), raw: get("sender").raw }),
      "other_transaction",
    ],
    ["text that is not hex", (): SignedTx => signedTx("0xzz"), "malformed_signature"],
  ] as const)("refuses %s", (_case, make, error) => {
    expect(scheme.verify(unsigned, make())).toStrictEqual({ ok: false, error });
  });

  it("refuses a sender that is no EVM address as another signer", () => {
    const from = accountRefSchema.parse("eip155:56:alice");
    expect(scheme.verify({ ...unsigned, from }, get("sender"))).toStrictEqual({
      ok: false,
      error: "other_signer",
    });
  });

  it("refuses a high-s signature even though it recovers the sender", async () => {
    const hash = keccak256(unsigned.payload as Hex);
    const { r, s, yParity } = await signHash(hash);
    const flipped = {
      r,
      s: toHex(curveOrder - hexToBigInt(s), { size: 32 }),
      yParity: 1 - yParity,
    };
    const raw = serializeTransaction(fieldsOf(tx), flipped);
    expect(scheme.verify(unsigned, signedTx(raw))).toStrictEqual({
      ok: false,
      error: "malformed_signature",
    });
  });
});

describe("recover signer", () => {
  const hash = keccak256(toHex("a message"));

  it("recovers the address that signed a hash", async () => {
    expect(recoverSigner(hash, await signHash(hash))).toStrictEqual({
      ok: true,
      value: sender.address,
    });
  });

  it.each([
    ["a recovery bit of 2", { r: toHex(1n, { size: 32 }), s: toHex(1n, { size: 32 }), yParity: 2 }],
    ["an r of zero", { r: toHex(0n, { size: 32 }), s: toHex(1n, { size: 32 }), yParity: 0 }],
  ])("refuses %s", (_case, signature) => {
    expect(recoverSigner(hash, signature)).toStrictEqual({
      ok: false,
      error: "malformed_signature",
    });
  });
});
