import { encodeFunctionData, getAbiItem, type Hex, pad, parseAbi } from "viem";
import { abiFunctionSchema } from "../ceiling/abi-function.schema.js";
import type { AbiFunction } from "../ceiling/policy-rule.js";

// Across's SpokePool deposits, as its source on GitHub declares them: `depositV3` takes 20-byte
// addresses, `deposit` 32-byte values (the form a Solana recipient needs).
const spokePool = parseAbi([
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
  "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
]);

// The ERC-8004 identity registry's three `register` overloads, as its verified source has them.
const identity = parseAbi([
  "struct MetadataEntry { string metadataKey; bytes metadataValue; }",
  "function register() returns (uint256 agentId)",
  "function register(string agentURI) returns (uint256 agentId)",
  "function register(string agentURI, MetadataEntry[] metadata) returns (uint256 agentId)",
]);

const approveAbiItems = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Across's `depositV3` and `deposit`, and the registry's `register(string)`, as JSON ABI entries. */
export const bridgeAbis: {
  readonly depositV3: AbiFunction;
  readonly deposit: AbiFunction;
  readonly register: AbiFunction;
} = {
  depositV3: abiFunctionSchema.parse(getAbiItem({ abi: spokePool, name: "depositV3" })),
  deposit: abiFunctionSchema.parse(getAbiItem({ abi: spokePool, name: "deposit" })),
  register: abiFunctionSchema.parse(
    getAbiItem({ abi: identity, name: "register", args: ["card"] }),
  ),
};

/** The arguments of an Across deposit that a ceiling or the signer reads. */
export interface DepositArgs {
  readonly depositor: Hex;
  readonly recipient: Hex;
  readonly inputToken: Hex;
  readonly outputToken: Hex;
  readonly destinationChainId: bigint;
  readonly message?: Hex;
}

function depositTuple(args: DepositArgs, widen: (value: Hex) => Hex) {
  return [
    widen(args.depositor),
    widen(args.recipient),
    widen(args.inputToken),
    widen(args.outputToken),
    20n * 10n ** 18n,
    19_900_000n,
    args.destinationChainId,
    widen("0x0000000000000000000000000000000000000000"),
    1_793_457_371,
    1_793_464_571,
    0,
    args.message ?? "0x",
  ] as const;
}

/** A `depositV3` call's data, with fixed amounts and deadlines. */
export function depositV3Data(args: DepositArgs): Hex {
  return encodeFunctionData({
    abi: spokePool,
    functionName: "depositV3",
    args: depositTuple(args, (value) => value),
  });
}

// A 20-byte address padded to 32 bytes on the left; 32 bytes as they are.
function to32(value: Hex): Hex {
  return value.length === 66 ? value : pad(value, { size: 32 });
}

/** A `deposit` call's data: each address argument given in 20 bytes is padded to 32 on the left. */
export function depositData(args: DepositArgs): Hex {
  return encodeFunctionData({
    abi: spokePool,
    functionName: "deposit",
    args: depositTuple(args, to32),
  });
}

/** Data of each `register` overload of the identity registry. */
export const registerData: {
  readonly none: Hex;
  readonly uri: Hex;
  readonly withMetadata: Hex;
} = {
  none: encodeFunctionData({ abi: identity, functionName: "register", args: [] }),
  uri: encodeFunctionData({ abi: identity, functionName: "register", args: ["data:,card"] }),
  withMetadata: encodeFunctionData({
    abi: identity,
    functionName: "register",
    args: ["data:,card", [{ metadataKey: "k", metadataValue: "0x01" }]],
  }),
};

/** An `approve(spender, amount)` call's data. */
export function approveTo(spender: Hex, amount: bigint): Hex {
  return encodeFunctionData({
    abi: approveAbiItems,
    functionName: "approve",
    args: [spender, amount],
  });
}
