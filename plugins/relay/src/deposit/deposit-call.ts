import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, getAddress, type Hex, parseAbiItem } from "viem";
import { lowerHex } from "../wire-values.schema.js";

// The depository's token deposit, from Relay's EVM Depository reference: it names the depositor
// it credits and the order id it pays, and nothing about who is paid where. Its coin deposit is
// never declared, since no route the registry lists leaves as a coin.
const depositErc20Abi = parseAbiItem(
  "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
);

/** `depositErc20` as the JSON ABI entry the bridge declares, a bridge wallet's alone. */
export const depositErc20Json: JsonValue = callAbiJson(depositErc20Abi);

/** What a `depositErc20` call says: who it credits, the token and amount, and the order id. */
export interface DepositTerms {
  readonly depositor: Address;
  readonly token: Address;
  readonly amount: bigint;
  /** The order id as lowercase hex of 32 bytes. */
  readonly orderId: Hex;
}

/** The `depositErc20` calldata, the one deposit the bridge builds. */
export function encodeDepositErc20(terms: DepositTerms): Hex {
  return encodeFunctionData({
    abi: [depositErc20Abi],
    functionName: "depositErc20",
    args: [terms.depositor, terms.token, terms.amount, terms.orderId],
  });
}

/**
 * Reads a `depositErc20` call from its calldata alone: only the exact bytes the bridge encodes,
 * with nothing after the arguments. Any other call is `undefined`.
 */
export function readDepositErc20(data: Hex): DepositTerms | undefined {
  const call = decodeCall([depositErc20Abi], data);
  if (!call.ok) {
    return undefined;
  }
  const [depositor, token, amount, id] = call.value.args;
  const terms = {
    depositor: getAddress(depositor),
    token: getAddress(token),
    amount,
    orderId: lowerHex(id),
  };
  return encodeDepositErc20(terms) === data.toLowerCase() ? terms : undefined;
}
