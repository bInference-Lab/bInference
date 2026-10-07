import {
  type Address,
  decodeAbiParameters,
  getAddress,
  type Hex,
  hexToBigInt,
  size,
  slice,
} from "viem";

/** What KyberSwap's executor is told to do, read from the router call's `targetData`. */
export interface ExecutorPayload {
  /** The account the executor pays the output to. */
  readonly recipient: Address;
  /** Unix seconds; the executor reverts with `QuoteExpired()` after it. */
  readonly deadlineSec: bigint;
}

// The executor's data, as KyberSwap's API encodes it for AggregationExecutorProxy: the executor
// implementation (20 bytes), then (uint256 amounts, bytes signature, bytes payload). KyberSwap signs
// the payload, whose word 0 is the recipient and word 8 the deadline. Checked on a fork: the call
// reverts one second past this deadline and passes one second before it.
const implementationBytes = 20;
const wordBytes = 32;
const recipientWord = 0;
const deadlineWord = 8;
const envelope = [{ type: "uint256" }, { type: "bytes" }, { type: "bytes" }] as const;

function wordOf(payload: Hex, index: number): Hex {
  return slice(payload, index * wordBytes, (index + 1) * wordBytes);
}

function payloadOf(targetData: Hex): Hex | undefined {
  try {
    const [, , payload] = decodeAbiParameters(envelope, slice(targetData, implementationBytes));
    return payload;
  } catch {
    return undefined;
  }
}

/**
 * Reads the recipient and the deadline from the executor data of a router call. Data too short
 * for the envelope, a payload under nine words, or a recipient word that holds more than an
 * address is undefined.
 */
export function readExecutorPayload(targetData: Hex): ExecutorPayload | undefined {
  const payload = size(targetData) > implementationBytes ? payloadOf(targetData) : undefined;
  if (payload === undefined || size(payload) < (deadlineWord + 1) * wordBytes) {
    return undefined;
  }
  const recipient = wordOf(payload, recipientWord);
  if (hexToBigInt(slice(recipient, 0, 12)) !== 0n) {
    return undefined;
  }
  return {
    recipient: getAddress(slice(recipient, 12)),
    deadlineSec: hexToBigInt(wordOf(payload, deadlineWord)),
  };
}
