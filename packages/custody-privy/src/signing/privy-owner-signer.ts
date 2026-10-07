import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  chainRefParts,
  type SignedTx,
  type Signer,
  type SignRequest,
} from "@binference/chain";
import {
  createEvmSigningScheme,
  type DecodedEvmTransaction,
  decodeEvmTransaction,
  parseEvmAddress,
} from "@binference/chain-evm";
import { BinferenceError, err, type Id, ok, type Result } from "@binference/core";
import type { SignerProcess } from "../ports.js";
import type { PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { AuthorizationSignature } from "../signer-process/authorize-request.js";
import type { PrivyRequest } from "../signer-process/privy-request.js";
import { privyTransaction } from "./privy-transaction.js";

/** An agent wallet as Privy holds it, checked by the read-back when it was made. */
export interface PrivyWallet {
  /** Privy's id of the wallet. */
  readonly id: PrivyId;
  /** The wallet's EVM address, checksummed. */
  readonly address: string;
  /** The chains its ceiling enables. */
  readonly chains: readonly ChainRef[];
}

/** What the `privy-owner` adapter is built from. */
export interface PrivyOwnerSignerOptions {
  readonly api: PrivyApi;
  /** The signer that holds the agent key and authorizes each request. */
  readonly signerProcess: SignerProcess;
  /** The Privy wallet behind an agent wallet, as the store keeps it; undefined for no wallet. */
  readonly walletOf: (wallet: Id<"wal">) => PrivyWallet | undefined;
}

const signaturePattern = /^[A-Za-z0-9+/]{16,200}={0,2}$/;

function accountOf(wallet: PrivyWallet, chain: ChainRef): AccountRef | undefined {
  return wallet.chains.includes(chain)
    ? accountRefSchema.parse(`${chain}:${wallet.address}`)
    : undefined;
}

// The sender is the wallet's address, on a chain the ceiling enables, in any case of its hex.
function isTheWallets(wallet: PrivyWallet, request: SignRequest): boolean {
  const { tx } = request;
  const sender = parseEvmAddress(accountRefParts(tx.from).address);
  return (
    accountOf(wallet, tx.chain) !== undefined &&
    accountRefParts(tx.from).chain === tx.chain &&
    sender.ok &&
    sender.value === wallet.address
  );
}

function checkedSignature(answer: AuthorizationSignature): string {
  if (!signaturePattern.test(answer.signature)) {
    throw new BinferenceError({
      code: "custody.signature_malformed",
      message: "The signer answered something that is no authorization signature.",
    });
  }
  return answer.signature;
}

function readable(request: SignRequest): DecodedEvmTransaction {
  const decoded = decodeEvmTransaction(request.tx);
  if (!decoded.ok) {
    throw new BinferenceError({
      code: "custody.transaction_unreadable",
      message: "The transaction to sign is not an unsigned EVM type 2 call.",
      details: { intent: request.intent },
    });
  }
  return decoded.value;
}

/** The parts one signing call shares. */
interface Signing {
  readonly options: PrivyOwnerSignerOptions;
  readonly request: SignRequest;
  readonly signal: AbortSignal;
}

async function authorize(
  signing: Signing,
  privyRequest: PrivyRequest,
  signal: AbortSignal,
): Promise<Result<string, "refused">> {
  const { request } = signing;
  const answer = await signing.options.signerProcess.authorize(
    {
      wallet: request.wallet,
      request: privyRequest,
      intent: request.intent,
      step: request.step,
      authorization: request.authorization,
      termsHash: request.termsHash,
      allowed: request.allowed,
    },
    { signal },
  );
  return answer.ok ? ok(checkedSignature(answer.value)) : answer;
}

function verified(request: SignRequest, raw: string): SignedTx {
  const signed: SignedTx = { chain: request.tx.chain, raw };
  if (!createEvmSigningScheme().verify(request.tx, signed).ok) {
    throw new BinferenceError({
      code: "custody.signed_other_transaction",
      message: "Privy answered a transaction other than the one asked, or signed by another key.",
      details: { intent: request.intent },
    });
  }
  return signed;
}

async function signWith(
  signing: Signing,
  wallet: PrivyWallet,
): Promise<Result<SignedTx, "unknown_wallet" | "refused">> {
  const { options, request, signal } = signing;
  const decoded = readable(request);
  if (chainRefParts(request.tx.chain).reference !== String(decoded.chainId)) {
    return err("refused");
  }
  const raw = await options.api.signTransaction(
    {
      wallet: wallet.id,
      transaction: privyTransaction(decoded),
      authorize: async (privyRequest, callSignal) => authorize(signing, privyRequest, callSignal),
    },
    { signal },
  );
  return raw.ok ? ok(verified(request, raw.value)) : raw;
}

/**
 * Creates the `privy-owner` custody adapter: the owner's Privy app holds each agent wallet, and
 * the signer's agent key authorizes each `eth_signTransaction` request under the wallet's
 * ceiling. One call sends Privy one request and never sends it again: a lost answer throws
 * `custody.sign_unknown`, and the engine decides what follows. A signature Privy never sent back
 * was never broadcast, since `eth_signTransaction` only signs. The signer and Privy share the
 * call's timeout. The signed bytes are checked against the request before they leave.
 */
export function createPrivyOwnerSigner(options: PrivyOwnerSignerOptions): Signer {
  return {
    async account(wallet, chain, { signal }) {
      signal.throwIfAborted();
      const held = options.walletOf(wallet);
      const account = held === undefined ? undefined : accountOf(held, chain);
      return Promise.resolve(account === undefined ? err("unknown_wallet") : ok(account));
    },
    async signTransaction(request, { signal }) {
      signal.throwIfAborted();
      const wallet = options.walletOf(request.wallet);
      if (wallet === undefined) {
        return err("unknown_wallet");
      }
      if (!isTheWallets(wallet, request)) {
        return err("refused");
      }
      return signWith({ options, request, signal }, wallet);
    },
  };
}
