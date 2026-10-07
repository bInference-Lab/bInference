import { assetRefSchema, chainRefSchema } from "@binference/chain";
import type { EvmChain } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { encodeFunctionData, type Hex, parseAbi } from "viem";
import type { CeilingRequest } from "../ceiling/ceiling.js";

/** BNB Smart Chain as the EVM family reads it, for tests that need no registry. */
export const testChain: EvmChain = {
  ref: chainRefSchema.parse("eip155:56"),
  chainId: 56,
  name: "BNB Smart Chain",
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  nativeSymbol: "BNB",
  nativeDecimals: 18,
};

/** Accounts for ceiling tests, checksummed. None holds code or funds on any chain. */
export const testAddresses = {
  /** A listed contract, such as a venue's router. */
  router: "0xECddb6423ae07F6Ba062b18f790f18fE3D88fa91",
  /** A listed contract that is also a registry spender, such as a Permit2. */
  permit2: "0x93e951d6c3508d09F7D0fA6891a8ECF31F67Ff9F",
  rescue: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
  saved: "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7",
  /** An address the owner never saved. */
  unsaved: "0x4C7f6780Ec91C6AC1D99dA89A90db7895a17dAcE",
  /** A token the wallet holds, which is no listed contract. */
  token: "0x52E30eafc87D104E67Dd8e1E16BE97191Ef2F99C",
  /** A contract no enabled venue declares. */
  unlisted: "0x85e99B4093C337A9d5EF478bE8E95d2632a638DD",
} as const;

/** One BNB in wei: the default cap per contract call (decision 0094). */
export const oneBnbWei: bigint = 10n ** 18n;

/** The ceiling request of the tests: one chain, a router and a Permit2, a rescue and a saved address. */
export function testCeilingRequest(): CeilingRequest {
  return {
    chains: [
      {
        chain: testChain,
        contracts: [testAddresses.router, testAddresses.permit2],
        spenders: [testAddresses.router, testAddresses.permit2],
        perTxNativeCapBase: oneBnbWei,
      },
    ],
    rescue: testAddresses.rescue,
    saved: [testAddresses.saved],
  };
}

function hexAddress(text: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new BinferenceError({ code: "internal.error", message: "A test address is malformed." });
  }
  return `0x${text.slice(2)}`;
}

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

/** Calldata of an ERC-20 `approve`. */
export function approveData(spender: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20,
    functionName: "approve",
    args: [hexAddress(spender), amount],
  });
}

/** Calldata of an ERC-20 `transfer`. */
export function transferData(to: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20,
    functionName: "transfer",
    args: [hexAddress(to), amount],
  });
}

/** Calldata of a `setApprovalForAll` that grants the operator every token. */
export function approvalForAllData(operator: string): Hex {
  return encodeFunctionData({
    abi: erc20,
    functionName: "setApprovalForAll",
    args: [hexAddress(operator), true],
  });
}
