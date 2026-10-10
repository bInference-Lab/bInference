import { createSecret, err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { SignerRevoker } from "../install/ports.js";
import type { RevokeRefusal } from "../install/signer-revocation.js";
import type { InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { answererOf, type EngineCall } from "./engine-call.js";
import { signerRevokedNotice } from "./signer-revoked-notice.js";

/** What a signer's removal reads the wallets from, asks custody through and announces on. */
export interface RevokeSignerOptions {
  readonly install: InstallStore;
  /** Custody's signer removal; none where custody removes no signer through the engine. */
  readonly revoker?: SignerRevoker;
  readonly publish: PublishPush;
}

const refusalCodes: Readonly<Record<RevokeRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  not_found: "wallet.not_found",
  not_signer: "signer.not_found",
  last_signer: "signer.last_signer",
};

/**
 * Removes a machine's agent key from every live wallet of the install, with the owner key over
 * IPC (spec 5, section 6): custody refuses whatever that key signs from then on. This engine's own
 * key is `signer.own_key`, since the engine would sign nothing more; the machine that replaces it
 * removes it as it attaches. A signer no live wallet lists is `signer.not_found`, one a wallet
 * lists alone `signer.last_signer`, and either changes nothing; a wrong key is
 * `wallet.bad_owner_key`. A removal is announced as the `notice.signerRevoked` notice. Without
 * custody's removal it is `wallet.custody_down`.
 */
export async function revokeSigner(
  options: RevokeSignerOptions,
  call: EngineCall<"signer/revoke">,
): Promise<Result<ResultOf<"signer/revoke">, ProtocolErrorCode>> {
  const { args, signal } = call;
  const { custody, wallets } = await options.install.read({ signal });
  if (custody?.agentQuorumId === args.signer) {
    return err("signer.own_key");
  }
  if (options.revoker === undefined) {
    return err("wallet.custody_down");
  }
  const request = {
    signer: args.signer,
    wallets: wallets
      .filter((wallet) => wallet.archivedAtMs === undefined)
      .map((wallet) => wallet.custodyWalletId),
    ownerKey: createSecret(args.ownerKey),
  };
  const revoked = await options.revoker.revoke(request, { signal });
  if (!revoked.ok) {
    return err(refusalCodes[revoked.error]);
  }
  const { surface } = answererOf(call.caller);
  options.publish(signerRevokedNotice({ signer: args.signer, surface }));
  return ok({});
}
