import type {
  AccountRef,
  PrivyRequest,
  SignedTx,
  Signer,
  SignerProcess,
  SignRequest,
} from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { PrivyApi } from "../privy/privy-api.js";
import { checkedSigned, isOnItsChain, readableTransaction } from "./checked-transaction.js";
import { privyTransaction } from "./privy-transaction.js";
import { accountOf, type PrivyWallet, signingWallet, type WalletLookup } from "./privy-wallet.js";

/** What the `privy-owner` adapter is built from. */
export interface PrivyOwnerSignerOptions {
  readonly api: PrivyApi;
  /** The signer that holds the agent key and authorizes each request. */
  readonly signerProcess: SignerProcess;
  /** The Privy wallet behind an agent wallet, as the store keeps it; undefined for no wallet. */
  readonly walletOf: WalletLookup;
}

const signaturePattern = /^[A-Za-z0-9+/]{16,200}={0,2}$/;

function checkedSignature(signature: string): string {
  if (!signaturePattern.test(signature)) {
    throw new BinferenceError({
      code: "custody.signature_malformed",
      message: "The signer answered something that is no authorization signature.",
    });
  }
  return signature;
}

/** The parts one signing call shares: the wallet, its account on the transaction's chain. */
interface Signing {
  readonly options: PrivyOwnerSignerOptions;
  readonly request: SignRequest;
  readonly wallet: PrivyWallet;
  readonly account: AccountRef;
  readonly signal: AbortSignal;
}

// The signer's `authorize` request: the engine's request, the Privy wallet and the exact request
// the SDK will send. A refusal by any rule is `refused`, and Privy hears nothing.
async function authorize(
  signing: Signing,
  privyRequest: PrivyRequest,
  signal: AbortSignal,
): Promise<Result<string, "refused">> {
  const { request, wallet, account } = signing;
  const answer = await signing.options.signerProcess.authorize(
    {
      wallet: {
        id: request.wallet,
        custodyId: wallet.id,
        account,
        ...(wallet.role === undefined ? {} : { role: wallet.role }),
      },
      request: privyRequest,
      intent: request.intent,
      step: request.step,
      authorization: request.authorization,
      termsHash: request.termsHash,
      allowed: request.allowed,
    },
    { signal },
  );
  return answer.ok ? ok(checkedSignature(answer.value)) : err("refused");
}

async function signWith(signing: Signing): Promise<Result<SignedTx, "unknown_wallet" | "refused">> {
  const { options, request, wallet, signal } = signing;
  const decoded = readableTransaction(request);
  if (!isOnItsChain(request, decoded)) {
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
  return raw.ok ? ok(checkedSigned(request, raw.value).signed) : raw;
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
    account: async (wallet, chain, { signal }) =>
      accountOf(options.walletOf, { wallet, chain, signal }),
    async signTransaction(request, { signal }) {
      signal.throwIfAborted();
      const signing = signingWallet(options.walletOf, request);
      return signing.ok ? signWith({ options, request, ...signing.value, signal }) : signing;
    },
  };
}
