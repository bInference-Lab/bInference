import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isHex,
  parseAbiItem,
  size,
  slice,
} from "viem";

// The deposit the bridge builds, with 20-byte addresses, so a ceiling binds every input that names
// who gets paid (decision 0302). The SpokePool keeps it beside `deposit` for older callers.
const depositV3Abi = parseAbiItem(
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
);

// The deposit Across's Swap API encodes: the same call with 32-byte values, which the bridge reads
// and never builds, so no ceiling holds it.
const apiDepositAbi = parseAbiItem(
  "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
);

/** `depositV3` as the JSON ABI entry the bridge declares: the one call a ceiling allows it. */
export const depositV3Json: JsonValue = callAbiJson(depositV3Abi);

/** Every argument of a SpokePool deposit, with each account as a 20-byte address. */
export interface DepositTerms {
  readonly depositor: Address;
  readonly recipient: Address;
  readonly inputToken: Address;
  readonly outputToken: Address;
  readonly inputAmount: bigint;
  readonly outputAmount: bigint;
  readonly destinationChainId: bigint;
  readonly exclusiveRelayer: Address;
  readonly quoteTimestamp: number;
  readonly fillDeadline: number;
  readonly exclusivityParameter: number;
  readonly message: Hex;
}

type Arguments = readonly [
  string,
  string,
  string,
  string,
  bigint,
  bigint,
  bigint,
  string,
  number,
  number,
  number,
  Hex,
];

/** The deposit's `depositV3` calldata, the one form the bridge builds. */
export function encodeDepositV3(terms: DepositTerms): Hex {
  return encodeFunctionData({
    abi: [depositV3Abi],
    functionName: "depositV3",
    args: [
      terms.depositor,
      terms.recipient,
      terms.inputToken,
      terms.outputToken,
      terms.inputAmount,
      terms.outputAmount,
      terms.destinationChainId,
      terms.exclusiveRelayer,
      terms.quoteTimestamp,
      terms.fillDeadline,
      terms.exclusivityParameter,
      terms.message,
    ],
  });
}

// A 32-byte account that holds a 20-byte address: its first 12 bytes are zero. Any other, such as
// a Solana account, is no EVM address.
function addressIn(word: string): Address | undefined {
  if (!isHex(word)) {
    return undefined;
  }
  if (size(word) === 20) {
    return getAddress(word);
  }
  const isPadded = size(word) === 32 && BigInt(slice(word, 0, 12)) === 0n;
  return isPadded ? getAddress(slice(word, 12)) : undefined;
}

function termsOf(args: Arguments): DepositTerms | undefined {
  const [depositor, recipient, inputToken, outputToken, ...rest] = args;
  const [inputAmount, outputAmount, destinationChainId, relayer, ...timing] = rest;
  const [quoteTimestamp, fillDeadline, exclusivityParameter, message] = timing;
  const accounts = [depositor, recipient, inputToken, outputToken, relayer].map(addressIn);
  const [from, to, tokenIn, tokenOut, exclusiveRelayer] = accounts;
  if (!from || !to || !tokenIn || !tokenOut || !exclusiveRelayer) {
    return undefined;
  }
  return {
    depositor: from,
    recipient: to,
    inputToken: tokenIn,
    outputToken: tokenOut,
    inputAmount,
    outputAmount,
    destinationChainId,
    exclusiveRelayer,
    quoteTimestamp,
    fillDeadline,
    exclusivityParameter,
    message,
  };
}

/**
 * Reads a `depositV3` call the bridge built, from its calldata alone: only the exact bytes the
 * bridge encodes, with nothing after the arguments. Any other call is `undefined`.
 */
export function readDepositV3(data: Hex): DepositTerms | undefined {
  const call = decodeCall([depositV3Abi], data);
  const terms = call.ok ? termsOf(call.value.args) : undefined;
  return terms !== undefined && encodeDepositV3(terms) === data.toLowerCase() ? terms : undefined;
}

/**
 * Reads the deposit Across's Swap API encoded: `deposit` with 32-byte values, or `depositV3`. Each
 * account must hold a 20-byte address. The bytes Across appends after the arguments to mark its
 * calls are left out: the bridge re-encodes the terms and never sends the API's bytes.
 */
export function readApiDeposit(data: Hex): DepositTerms | undefined {
  const asDeposit = decodeCall([apiDepositAbi], data);
  if (asDeposit.ok) {
    return termsOf(asDeposit.value.args);
  }
  const asV3 = decodeCall([depositV3Abi], data);
  return asV3.ok ? termsOf(asV3.value.args) : undefined;
}
