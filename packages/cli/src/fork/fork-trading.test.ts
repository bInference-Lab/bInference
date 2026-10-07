import { accountRefSchema, chainRefSchema, type UnsignedTx } from "@binference/chain";
import { createEvmSigningScheme, encodeEvmTransaction, evmChainOf } from "@binference/chain-evm";
import { signerContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import { idSchema } from "@binference/core";
import { keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { forkCustody, forkWallet } from "./fork-trading.js";

const key = keccak256(toHex("binference fork custody contract"));
const chain = evmChainOf(bsc);
const address = forkWallet(key).address;
const account = accountRefSchema.parse(`${chain.ref}:${address}`);
const wallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000044");
const stranger = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

function transactionFrom(from: `0x${string}`): UnsignedTx {
  return encodeEvmTransaction(chain, {
    from,
    to: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    value: 1n,
    data: "0x",
    nonce: 0,
    gas: 21_000n,
    fees: { maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n },
  });
}

describe("the fork suite's custody", () => {
  it.each(
    signerContract({
      create: () => ({
        signer: forkCustody(wallet, account, key),
        scheme: createEvmSigningScheme(),
        wallet,
        account,
        otherChain: chainRefSchema.parse("eip155:1"),
        unknownWallet: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000045"),
        tx: transactionFrom(address),
        foreignTx: transactionFrom(stranger),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
