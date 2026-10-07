import type { RelayRefusal } from "@binference/chain";
import type { JsonRpcError } from "../rpc/json-rpc-reply.schema.js";

/** How a relay's JSON-RPC error reads: the relay holds the transaction already, or a refusal. */
export type RelayErrorReading = "already_known" | RelayRefusal;

// 48 Club's trouble-shooting page: 4802 is its quota of gas for transactions below 1 gwei.
const gasQuotaCode = 4802;

// The relays forward to BSC nodes, which answer `eth_sendRawTransaction` with the txpool's errors
// (bnb-chain/bsc core/txpool/errors.go and core/error.go) under the generic -32000, so only the
// message tells them apart. 48 Club adds "require GasPrice=%d, Provide=%d" and "insufficient
// gasprice increasement for overwriting"; BlockRazor documents "rlp: element is larger than
// containing list". The first pattern that matches wins.
const readings: readonly (readonly [RegExp, RelayErrorReading])[] = [
  [/already known/i, "already_known"],
  [/nonce too low/i, "nonce_too_low"],
  [
    /replacement transaction underpriced|insufficient gasprice increasement/i,
    "replacement_underpriced",
  ],
  [
    /underpriced|gas price below minimum|require gasprice|fee per gas less than block base fee/i,
    "underpriced",
  ],
  [/insufficient funds/i, "insufficient_funds"],
  [
    /rlp|invalid sender|invalid chain id|transaction type not supported|intrinsic gas too low|exceeds block gas limit|oversized data|gas limit too high|priority fee per gas higher/i,
    "malformed_transaction",
  ],
  [/rate ?limit|too many requests/i, "rate_limited"],
];

/**
 * Reads a relay's JSON-RPC error into what it means for the transaction. An error no relay
 * documents is `rejected`; its code goes to the record, its text nowhere.
 */
export function readRelayError(error: JsonRpcError): RelayErrorReading {
  if (error.code === gasQuotaCode) {
    return "gas_quota";
  }
  return readings.find(([pattern]) => pattern.test(error.message))?.[1] ?? "rejected";
}
