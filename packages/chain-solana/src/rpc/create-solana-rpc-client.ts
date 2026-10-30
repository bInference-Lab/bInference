import { createSolanaRpcFromTransport, type Rpc, type SolanaRpcApiMainnet } from "@solana/kit";
import { createSolanaTransport, type SolanaTransportOptions } from "./create-solana-transport.js";

/**
 * Solana's SDK client for a mainnet cluster over {@link createSolanaTransport}, so a caller reads
 * through the `Http` port without importing the SDK itself.
 */
export function createSolanaRpcClient(options: SolanaTransportOptions): Rpc<SolanaRpcApiMainnet> {
  return createSolanaRpcFromTransport(createSolanaTransport(options));
}
