import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a signer removed with the owner key. */
export const signerRevokedKey = "notice.signerRevoked";

/**
 * The notice that announces on every surface that the owner key removed a machine's agent key
 * from the wallets: the signer and the surface it came from. A removal the owner did not make
 * means someone holds the owner key, so it tells them to freeze.
 */
export function signerRevokedNotice(change: {
  readonly signer: string;
  readonly surface: string;
}): EnginePush {
  return noticePush({
    key: signerRevokedKey,
    values: { signer: change.signer, surface: change.surface },
  });
}
