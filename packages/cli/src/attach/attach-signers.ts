import { ok, type Secret } from "@binference/core";
import {
  createPrivyApi,
  type OwnerAuthorize,
  type PrivyId,
  type SignedWallet,
  type SignerSwapRefusal,
  swapSigner,
} from "@binference/custody-privy";
import { type InitContext, type InitStep, type Refused, refused } from "../init/init-context.js";
import { agentQuorumName } from "../init/wallet-step.js";

/** What moving the wallets' signer takes: the app, the owner key, the new key and the wallets. */
export interface SignerMoveInputs {
  readonly appId: string;
  readonly appSecret: Secret;
  readonly authorize: OwnerAuthorize;
  /** The new agent key's public half, DER SubjectPublicKeyInfo in base64. */
  readonly agentKey: string;
  /** The wallets that move, each with the ceiling its signer is bound to. */
  readonly wallets: readonly SignedWallet[];
}

/** The new agent key's key quorum on Privy, and the signers it replaced. */
export interface MovedSigners {
  readonly signer: PrivyId;
  readonly removed: readonly PrivyId[];
}

// Each change the owner key signs goes out at once, so each expires 5 minutes after it is signed.
const expiryMs = 5 * 60_000;

// Each refusal's code and the `init` message that tells the owner why.
const refusals: Readonly<Record<SignerSwapRefusal, readonly [string, string]>> = {
  refused: ["init.attach_refused", "refused.attachRefused"],
  expired: ["init.attach_expired", "refused.attachExpired"],
  not_found: ["init.attach_wallet_gone", "refused.attachWalletGone"],
};

function refusalOf(error: SignerSwapRefusal): Refused {
  const [code, key] = refusals[error];
  return refused(code, key);
}

/**
 * Moves the wallets to the new agent key on Privy (keys spec, section 6): a key quorum for
 * the key, then for each wallet one change the owner key signs that makes it the wallet's one
 * signer, bound to the wallet's ceiling, and removes the signer it had. Each wallet is read back.
 * Privy refusing the owner key's signature, a change Privy read after its expiry, or a wallet
 * Privy holds no more stops the move there; the same attach again goes on from where it stopped.
 */
export async function moveSigners(
  context: InitContext,
  inputs: SignerMoveInputs,
): Promise<InitStep<MovedSigners>> {
  const { host, signal } = context;
  const { appId, appSecret, wallets } = inputs;
  const api = createPrivyApi({ http: host.http, clock: host.clock, appId, appSecret });
  context.prompter.say(context.words("attach.moving", { count: wallets.length }));
  const quorum = await api.createKeyQuorum(
    { publicKey: inputs.agentKey, displayName: agentQuorumName },
    { signal },
  );
  const expiry = () => host.clock.now() + expiryMs;
  const swapped = await swapSigner(
    api,
    { wallets, signer: quorum.id },
    { authorize: inputs.authorize, expiry, signal },
  );
  return swapped.ok ? ok({ signer: quorum.id, removed: swapped.value }) : refusalOf(swapped.error);
}
