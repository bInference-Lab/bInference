import { BinferenceError, err, type Logger, ok, type Result } from "@binference/core";
import { isPrivyId, type PrivyApi } from "@binference/custody-privy";
import type { InstallStore } from "@binference/engine/install";
import type { LockReason } from "../unlock/unlock-keys.js";

/** What the check reads: the install's custody and wallets, and Privy. */
export interface CheckAttachedOptions {
  readonly install: Pick<InstallStore, "read">;
  readonly api: PrivyApi;
  readonly logger: Logger;
}

/**
 * Whether this machine's agent key is still the signer of every live wallet on Privy (decision
 * 0140): a wallet that no longer lists the install's key quorum was attached to another machine,
 * or the owner key removed this one, and the engine stays locked with `signer_revoked`. A wallet
 * Privy no longer holds is left to the signer's own refusals; Privy out of reach is
 * `custody_unreachable`. Reads one wallet at a time.
 */
export async function checkAttached(
  options: CheckAttachedOptions,
  signal: AbortSignal,
): Promise<Result<void, LockReason>> {
  const { custody, wallets } = await options.install.read({ signal });
  const live = wallets
    .filter((record) => record.archivedAtMs === undefined)
    .map((record) => record.custodyWalletId)
    .filter(isPrivyId);
  try {
    for (const wallet of live) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one read at a time, as Privy's limits ask
      const record = await options.api.wallet(wallet, { signal });
      const signers = record.ok ? record.value.signers : [];
      if (record.ok && !signers.some((item) => item.signerId === custody?.agentQuorumId)) {
        options.logger.error("signer.revoked", { errorCode: "custody.signer_removed" });
        return err("signer_revoked");
      }
    }
    return ok(undefined);
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("custody.unreachable", { errorCode });
    return err("custody_unreachable");
  }
}
