import type { SolanaAnswer } from "./solana-answer.schema.js";

/**
 * Hands an answer to Solana's SDK as the response type its RPC method declares. The SDK's own
 * transport does the same: every result is parsed by a schema of the reader that asked for it.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the SDK's transport type names the response its caller expects
export function assertRpcResponse<TResponse>(answer: SolanaAnswer): TResponse {
  return answer.body as TResponse;
}
