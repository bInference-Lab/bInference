import { ok, type Secret } from "@binference/core";
import {
  createPrivyApi,
  isPrivyId,
  type OwnerAuthorize,
  type PrivyId,
  type SignedWallet,
  swapSigner,
} from "@binference/custody-privy";
import type { WalletRecord } from "@binference/engine/install";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { agentQuorumName } from "../init/wallet-step.js";

/** What moving the wallets' signer takes: the app, the owner key, the new key and the wallets. */
export interface SignerMoveInputs {
  readonly appId: string;
  readonly appSecret: Secret;
  readonly authorize: OwnerAuthorize;
  /** The new agent key's public half, DER SubjectPublicKeyInfo in base64. */
  readonly agentKey: string;
  /** The install's live wallets. */
  readonly wallets: readonly WalletRecord[];
}

/** The new agent key's key quorum on Privy, and the signers it replaced. */
export interface MovedSigners {
  readonly signer: PrivyId;
  readonly removed: readonly PrivyId[];
}

// A change the owner key signs goes out at once.
const expiryMs = 5 * 60_000;

function signedWalletsOf(wallets: readonly WalletRecord[]): readonly SignedWallet[] {
  return wallets.flatMap(({ custodyWalletId: wallet, policyId: policy }) =>
    isPrivyId(wallet) && isPrivyId(policy) ? [{ wallet, policy }] : [],
  );
}

/**
 * Moves every live wallet to the new agent key on Privy (keys spec, section 6): a key quorum for
 * the key, then for each wallet one change the owner key signs that makes it the wallet's one
 * signer, bound to the wallet's ceiling, and removes the signer it had. Each wallet is read back.
 * Privy refusing the owner key's signature, or holding a wallet no more, stops the move there;
 * the same attach again goes on from where it stopped.
 */
export async function moveSigners(
  context: InitContext,
  inputs: SignerMoveInputs,
): Promise<InitStep<MovedSigners>> {
  const { host, signal } = context;
  const wallets = signedWalletsOf(inputs.wallets);
  if (wallets.length < inputs.wallets.length) {
    return refused("init.attach_wallet_gone", "refused.attachWalletGone");
  }
  const { appId, appSecret } = inputs;
  const api = createPrivyApi({ http: host.http, clock: host.clock, appId, appSecret });
  context.prompter.say(context.words("attach.moving", { count: wallets.length }));
  const quorum = await api.createKeyQuorum(
    { publicKey: inputs.agentKey, displayName: agentQuorumName },
    { signal },
  );
  const expiresAtMs = host.clock.now() + expiryMs;
  const authorize = inputs.authorize;
  const swapped = await swapSigner(
    api,
    { wallets, signer: quorum.id },
    { authorize, expiresAtMs, signal },
  );
  if (!swapped.ok) {
    return swapped.error === "refused"
      ? refused("init.attach_refused", "refused.attachRefused")
      : refused("init.attach_wallet_gone", "refused.attachWalletGone");
  }
  return ok({ signer: quorum.id, removed: swapped.value });
}
