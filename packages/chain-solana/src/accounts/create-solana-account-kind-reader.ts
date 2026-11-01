import type { AccountKind, AccountKindReader } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { isOffCurveAddress, type Rpc, type SolanaRpcApiMainnet } from "@solana/kit";
import { type SolanaChain, solanaAddressOn } from "../solana-chain.js";
import { accountOwnerSchema } from "./account-owner.schema.js";

/** What the Solana account kind reader reads one cluster through. */
export interface SolanaAccountKindReaderOptions {
  /** Solana's SDK client over `createSolanaTransport`. */
  readonly rpc: Rpc<SolanaRpcApiMainnet>;
  readonly chain: SolanaChain;
}

// The System Program, which owns every wallet's account.
const systemProgram = "11111111111111111111111111111111";

/**
 * Creates the `AccountKindReader` of one Solana cluster, read only, through Solana's SDK
 * (decision 0298). An address off the ed25519 curve, such as a program-derived address, has no key
 * that can sign for it and is no wallet, whatever it holds, so it is refused unread. Any other is
 * read with `getAccountInfo` at the latest finalized slot, with no data: no account yet, or one the
 * System Program owns that holds no data and is not executable, is a wallet; an executable
 * program, an account another program owns, such as a token account, and one that holds data,
 * such as a durable nonce, are not. An answer it cannot read is a retryable fault, as a node that
 * does not answer; an account of another chain is a fault.
 */
export function createSolanaAccountKindReader(
  options: SolanaAccountKindReaderOptions,
): AccountKindReader {
  const { rpc, chain } = options;
  return {
    chain: chain.ref,
    async read(account, { signal }): Promise<AccountKind> {
      signal.throwIfAborted();
      const address = solanaAddressOn(chain, account);
      if (isOffCurveAddress(address)) {
        return "not_wallet";
      }
      const config = {
        commitment: "finalized",
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      } as const;
      const answer = await rpc.getAccountInfo(address, config).send({ abortSignal: signal });
      const parsed = accountOwnerSchema.safeParse(answer);
      if (!parsed.success) {
        throw new BinferenceError({
          code: "chain.bad_answer",
          message: "A Solana node answered an account read with no owner binference can read.",
          retryable: true,
        });
      }
      const held = parsed.data;
      if (held === null) {
        return "wallet";
      }
      const isPlain = !held.executable && held.owner === systemProgram && held.space === 0n;
      return isPlain ? "wallet" : "not_wallet";
    },
  };
}
