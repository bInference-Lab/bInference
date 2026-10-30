import { BinferenceError } from "@binference/core";
import type { Address, Rpc, SolanaRpcApiMainnet } from "@solana/kit";
import { type MintAccount, mintAccountSchema } from "../delivery/solana-reads.schema.js";

/**
 * Reads a token's mint account (`getAccountInfo` with `jsonParsed`), so a registry token is read
 * back on the cluster before it enters the registry. An address with no account, or whose account
 * is no initialized mint, is a `chain.not_a_mint` fault.
 */
export async function readSolanaMint(
  rpc: Rpc<SolanaRpcApiMainnet>,
  mint: Address,
  signal: AbortSignal,
): Promise<MintAccount> {
  const answer = await rpc
    .getAccountInfo(mint, { encoding: "jsonParsed" })
    .send({ abortSignal: signal });
  const account = mintAccountSchema.safeParse(answer);
  const value = account.success ? account.data : null;
  if (value === null || !value.isInitialized) {
    throw new BinferenceError({
      code: "chain.not_a_mint",
      message: "The address holds no initialized token mint.",
      details: { mint },
    });
  }
  return value;
}
