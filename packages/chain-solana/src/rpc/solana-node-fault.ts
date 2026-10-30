// Solana's JSON-RPC errors that say the node, not the call, failed, so another node may answer:
// the standard internal error and method not found, and the server errors a node sends while it
// lags, is unhealthy, keeps no history for the slot or key, or cannot reach its long-term
// storage. Codes from the RPC server's own error list (solana-rpc-client-api's custom_error.rs):
// -32001 block cleaned up, -32004 block not available, -32005 node unhealthy, -32009 slot skipped
// in long-term storage, -32010 key excluded from the secondary index, -32011 transaction history
// not available, -32014 block status not yet available, -32016 minimum context slot not reached,
// -32019 long-term storage unreachable.
const nodeFaultCodes: ReadonlySet<bigint> = new Set([
  -32_601n,
  -32_603n,
  -32_001n,
  -32_004n,
  -32_005n,
  -32_009n,
  -32_010n,
  -32_011n,
  -32_014n,
  -32_016n,
  -32_019n,
]);

/**
 * Whether a JSON-RPC error code says the Solana node failed, so another endpoint may answer the
 * same call. Any other error, such as bad params, is the call's own answer.
 */
export function isSolanaNodeFault(code: bigint): boolean {
  return nodeFaultCodes.has(code);
}
