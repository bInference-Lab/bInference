import { type Clock, err, ok, type Result } from "@binference/core";
import { isPrivyId, type PrivyApi } from "@binference/custody-privy";
import type {
  ExportRefusal,
  ExportRequest,
  SealedKey,
  WalletExporter,
} from "@binference/engine/install";
import { ownerAuthorize, type OwnerKeyHolder } from "./owner-authorize.js";

/** What the Privy wallet exporter reaches Privy with, and the owner key it takes. */
export interface PrivyWalletExporterOptions extends OwnerKeyHolder {
  readonly api: PrivyApi;
  readonly clock: Clock;
}

// An export signed now goes out at once.
const expiryMs = 5 * 60_000;

async function exportSealed(
  options: PrivyWalletExporterOptions,
  request: ExportRequest,
  signal: AbortSignal,
): Promise<Result<SealedKey, ExportRefusal>> {
  const authorize = await ownerAuthorize(options, request.ownerKey, signal);
  if (!authorize.ok) {
    return authorize;
  }
  const { wallet, recipientPublicKey } = request;
  if (!isPrivyId(wallet)) {
    return err("not_found");
  }
  const expiresAtMs = options.clock.now() + expiryMs;
  const exported = await options.api.exportWallet(
    { wallet, recipientPublicKey, authorize: authorize.value, expiresAtMs },
    { signal },
  );
  if (exported.ok) {
    return ok(exported.value);
  }
  return err(exported.error === "refused" ? "bad_owner_key" : exported.error);
}

/**
 * The {@link WalletExporter} on the owner's Privy app (decision 0131): it reads the owner key from
 * its code, checks it is the key that owns the install, and asks Privy's export, signed with it,
 * for the wallet's key sealed with HPKE to the request's recipient key. Privy never answers the
 * key in the clear and this adapter opens nothing; the owner key serves the one request.
 */
export function createPrivyWalletExporter(options: PrivyWalletExporterOptions): WalletExporter {
  return { exportSealed: async (request, { signal }) => exportSealed(options, request, signal) };
}
