import type { JsonRpcError } from "./json-rpc-reply.schema.js";

// Codes a node sends when it, not the request, failed: method not found or not supported,
// resource not found or unavailable, limit exceeded, internal error.
const nodeFaultCodes: ReadonlySet<number> = new Set([
  -32_601, -32_004, -32_001, -32_002, -32_005, -32_603,
]);

// Geth and its forks answer a block the node has not seen yet and throttling with the generic
// -32000, so only the message tells them apart from a failed call.
const nodeFaultMessage = /header not found|unknown block|rate limit|too many requests|timed? ?out/i;

const revertMessage = /revert/i;

// Geth and its forks, BNB Smart Chain's among them, answer a read of state they pruned with these
// messages under -32000: the hash-based store's and the path-based store's.
const missingStateMessage =
  /missing trie node|historical state .*not available|state not available/i;

/** Whether a JSON-RPC error says the node no longer holds the state the call reads. */
export function isMissingState(error: JsonRpcError): boolean {
  return missingStateMessage.test(error.message);
}

/**
 * Whether a JSON-RPC error says the node failed, so another endpoint may answer the same call. A
 * revert, bad params or a nonce problem is the call's own answer and stays with the caller.
 */
export function isNodeFault(error: JsonRpcError): boolean {
  if (revertMessage.test(error.message)) {
    return false;
  }
  return nodeFaultCodes.has(error.code) || nodeFaultMessage.test(error.message);
}
