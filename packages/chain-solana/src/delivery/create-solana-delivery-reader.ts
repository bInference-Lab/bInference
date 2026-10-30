import type { Delivery, DeliveryReader, DeliveryRequest } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import {
  type Address,
  isSignature,
  type Rpc,
  type Signature,
  type SolanaRpcApiMainnet,
} from "@solana/kit";
import { type SolanaChain, solanaAddressOn, solanaMintOn } from "../solana-chain.js";
import {
  lamportsSchema,
  type ParsedTransaction,
  type TokenBalance,
  tokenAccountsSchema,
  transactionSchema,
} from "./solana-reads.schema.js";

/** What the Solana delivery reader reads one cluster through. */
export interface SolanaDeliveryReaderOptions {
  /** Solana's SDK client over `createSolanaTransport`. */
  readonly rpc: Rpc<SolanaRpcApiMainnet>;
  readonly chain: SolanaChain;
}

/** One delivery read: what is asked, in the cluster's own forms. */
interface DeliveryAsk {
  readonly signature: Signature;
  readonly recipient: Address;
  /** The token's mint, or `undefined` for SOL. */
  readonly mint: Address | undefined;
}

// Base58 text first: the SDK's own check throws on a letter base58 leaves out.
const base58Signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function signatureOf(chain: SolanaChain, hash: string): Signature {
  if (!base58Signature.test(hash) || !isSignature(hash)) {
    throw new BinferenceError({
      code: "chain.bad_hash",
      message: `A ${chain.name} transaction is named by its base58 signature of 64 bytes.`,
      details: { chain: chain.ref },
    });
  }
  return hash;
}

function grew(before: bigint, after: bigint): bigint {
  return after > before ? after - before : 0n;
}

// SOL: the recipient's lamports after the transaction less before, at its place in the keys.
function lamportsReceived(transaction: ParsedTransaction, recipient: Address): bigint {
  const index = transaction.accountKeys.indexOf(recipient);
  const before = transaction.preBalances[index];
  const after = transaction.postBalances[index];
  return before === undefined || after === undefined ? 0n : grew(before, after);
}

// A token: the amount every account the recipient owns holds of the mint, after less before.
function tokensReceived(transaction: ParsedTransaction, ask: DeliveryAsk): bigint {
  const held = (balances: readonly TokenBalance[]): bigint =>
    balances
      .filter(({ owner, mint }) => owner === ask.recipient && mint === ask.mint)
      .reduce((sum, { amount }) => sum + amount, 0n);
  return grew(held(transaction.preTokenBalances), held(transaction.postTokenBalances));
}

async function readDelivery(
  options: SolanaDeliveryReaderOptions,
  request: DeliveryRequest,
  signal: AbortSignal,
): Promise<Delivery | undefined> {
  const { rpc, chain } = options;
  const ask: DeliveryAsk = {
    signature: signatureOf(chain, request.hash),
    recipient: solanaAddressOn(chain, request.recipient),
    mint: solanaMintOn(chain, request.asset),
  };
  // Read at `finalized` (decision 0298): a transaction no finalized block holds yet reads as none.
  const config = {
    commitment: "finalized",
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
  } as const;
  const found = transactionSchema.parse(
    await rpc.getTransaction(ask.signature, config).send({ abortSignal: signal }),
  );
  if (found === null) {
    return undefined;
  }
  const { failed } = found;
  const received =
    ask.mint === undefined ? lamportsReceived(found, ask.recipient) : tokensReceived(found, ask);
  return {
    hash: request.hash,
    block: found.slot,
    final: true,
    status: failed ? "failed" : "success",
    received: { asset: request.asset, base: failed ? 0n : received },
  };
}

/** One balance read: whose, of which mint (`undefined` for SOL). */
interface BalanceAsk {
  readonly owner: Address;
  readonly mint: Address | undefined;
}

async function readBalance(
  options: SolanaDeliveryReaderOptions,
  { owner, mint }: BalanceAsk,
  signal: AbortSignal,
): Promise<bigint> {
  const { rpc } = options;
  if (mint === undefined) {
    const lamports = await rpc.getBalance(owner).send({ abortSignal: signal });
    return lamportsSchema.parse(lamports);
  }
  const accounts = await rpc
    .getTokenAccountsByOwner(owner, { mint }, { encoding: "jsonParsed" })
    .send({ abortSignal: signal });
  return tokenAccountsSchema.parse(accounts);
}

/**
 * Creates the `DeliveryReader` of one Solana cluster, read only, through Solana's SDK. SOL's
 * balance is `getBalance`; a token's is the sum of the owner's token accounts of its mint
 * (`getTokenAccountsByOwner`, either token program). A delivery is read from `getTransaction` at
 * `finalized` commitment (decision 0298), so it is always final and one not finalized yet reads
 * as none: SOL as the recipient's lamports after less before; a token as what the accounts the
 * recipient owns of the mint hold after less before; a failed one as 0. A recipient, an asset or
 * a hash that is not this cluster's is a fault.
 */
export function createSolanaDeliveryReader(options: SolanaDeliveryReaderOptions): DeliveryReader {
  const { chain } = options;
  return {
    chain: chain.ref,
    async balance(account, asset, { signal }) {
      signal.throwIfAborted();
      const ask = { owner: solanaAddressOn(chain, account), mint: solanaMintOn(chain, asset) };
      return readBalance(options, ask, signal);
    },
    async delivery(request, { signal }) {
      signal.throwIfAborted();
      return readDelivery(options, request, signal);
    },
  };
}
