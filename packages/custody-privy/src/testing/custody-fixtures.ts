import { assetRefSchema, chainRefSchema } from "@binference/chain";
import type { EvmChain } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { encodeFunctionData, type Hex, parseAbi } from "viem";
import type { CeilingCall, CeilingRequest, ChainCaps, LaunchCeiling } from "../ceiling/ceiling.js";
import type { ChainCapPlan } from "../ceiling/day-caps.js";
import type { AbiFunction } from "../ceiling/policy-rule.js";

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
  /** A venue's router: its `swap` and `swapTo` are listed, and it is the one spender. */
  router: "0xECddb6423ae07F6Ba062b18f790f18fE3D88fa91",
  /** A Permit2 no venue of the tests calls or approves. */
  permit2: "0x93e951d6c3508d09F7D0fA6891a8ECF31F67Ff9F",
  rescue: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
  saved: "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7",
  /** An address the owner never saved. */
  unsaved: "0x4C7f6780Ec91C6AC1D99dA89A90db7895a17dAcE",
  /** A token the wallet holds, which is no listed contract. */
  token: "0x52E30eafc87D104E67Dd8e1E16BE97191Ef2F99C",
  /** A contract no enabled venue declares. */
  unlisted: "0x85e99B4093C337A9d5EF478bE8E95d2632a638DD",
  /** A launch's own curve, which no list holds: only a launch wallet's rules reach it. */
  curve: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
} as const;

/** One BNB in wei: the default cap per contract call (decision 0094). */
export const oneBnbWei: bigint = 10n ** 18n;

const amountInputs = [
  { name: "amountIn", type: "uint256" },
  { name: "minOut", type: "uint256" },
] as const;

/** The router's functions in the tests: `swap` pays the sender, `swapTo` its `receiver`. */
export const testRouterAbi: { readonly swap: AbiFunction; readonly swapTo: AbiFunction } = {
  swap: {
    type: "function",
    name: "swap",
    inputs: amountInputs,
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
  },
  swapTo: {
    type: "function",
    name: "swapTo",
    inputs: [{ name: "receiver", type: "address" }, ...amountInputs],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
  },
};

const curveInputs = [
  { name: "amountIn", type: "uint256" },
  { name: "minOut", type: "uint256" },
  { name: "recipient", type: "address" },
] as const;

/** A launch's curve in the tests: `buy` and `sell` each pay the `recipient` they name. */
export const testCurveAbi: { readonly buy: AbiFunction; readonly sell: AbiFunction } = {
  buy: {
    type: "function",
    name: "buy",
    inputs: curveInputs,
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
  },
  sell: {
    type: "function",
    name: "sell",
    inputs: curveInputs,
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
};

/**
 * What the tests' launchpad declares on each launch's curve: `buy` and `sell` paying the wallet
 * itself, and the curve as a spender, so a launch wallet's ceiling approves any spender.
 */
export const testLaunch: LaunchCeiling = {
  calls: [
    { abi: testCurveAbi.buy, walletInputs: ["recipient"] },
    { abi: testCurveAbi.sell, walletInputs: ["recipient"] },
  ],
  approvesAnySpender: true,
};

/** The calls the tests' venue declares on the router: `swapTo` only to the wallet itself. */
export const testCalls: readonly CeilingCall[] = [
  { contract: testAddresses.router, abi: testRouterAbi.swap, walletInputs: [] },
  { contract: testAddresses.router, abi: testRouterAbi.swapTo, walletInputs: ["receiver"] },
];

/** The 24-hour caps of the tests' pure checks: 3 BNB sent, and 1,000 base units of the token. */
export const testCaps: ChainCaps = {
  native: { aggregation: "testcapnative000000000000", limitBase: 3n * 10n ** 18n },
  approvals: [{ aggregation: "testcaptoken0000000000000", limitBase: 1_000n }],
};

/**
 * The caps the custody contract makes on a Privy app: 100 BNB sent, more than its checks send in
 * all, and 1,000 base units of the token approved.
 */
export const testCapPlan: ChainCapPlan = {
  chain: testChain,
  nativeLimitBase: 100n * 10n ** 18n,
  approvals: [{ token: testAddresses.token, limitBase: 1_000n }],
};

/**
 * The ceiling request of the tests: one chain whose router's `swap` and `swapTo` are listed and
 * which is the one spender, the caps given, a rescue and a saved address.
 */
export function testCeilingRequest(caps: ChainCaps = testCaps): CeilingRequest {
  return {
    chains: [
      {
        chain: testChain,
        calls: testCalls,
        spenders: [testAddresses.router],
        perTxNativeCapBase: oneBnbWei,
        caps,
      },
    ],
    rescue: testAddresses.rescue,
    saved: [testAddresses.saved],
  };
}

/** The tests' ceiling request for a launch wallet: the test request's with the launch rules. */
export function testLaunchCeilingRequest(caps: ChainCaps = testCaps): CeilingRequest {
  const request = testCeilingRequest(caps);
  const [chain] = request.chains;
  return chain === undefined ? request : { ...request, chains: [{ ...chain, launch: testLaunch }] };
}

function hexAddress(text: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new BinferenceError({ code: "internal.error", message: "A test address is malformed." });
  }
  return `0x${text.slice(2)}`;
}

const router = parseAbi([
  "function swap(uint256 amountIn, uint256 minOut) payable returns (uint256)",
  "function swapTo(address receiver, uint256 amountIn, uint256 minOut) payable returns (uint256)",
  "function sweep(address token, address to)",
]);

/** Calldata of the router's `swap`, which pays the sender. */
export function swapData(amountIn: bigint): Hex {
  return encodeFunctionData({ abi: router, functionName: "swap", args: [amountIn, 0n] });
}

/** Calldata of the router's `swapTo`, which pays `receiver`. */
export function swapToData(receiver: string, amountIn: bigint): Hex {
  const args = [hexAddress(receiver), amountIn, 0n] as const;
  return encodeFunctionData({ abi: router, functionName: "swapTo", args });
}

/** Calldata of the router's `sweep`, a function no venue of the tests declares. */
export function sweepData(token: string, to: string): Hex {
  const args = [hexAddress(token), hexAddress(to)] as const;
  return encodeFunctionData({ abi: router, functionName: "sweep", args });
}

const curve = parseAbi([
  "function buy(uint256 amountIn, uint256 minOut, address recipient) payable returns (uint256)",
  "function sell(uint256 amountIn, uint256 minOut, address recipient) returns (uint256)",
]);

/** Calldata of a curve's `buy` or `sell` that pays `recipient`. */
export function curveData(side: "buy" | "sell", recipient: string): Hex {
  const args = [5n, 0n, hexAddress(recipient)] as const;
  return encodeFunctionData({ abi: curve, functionName: side, args });
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
