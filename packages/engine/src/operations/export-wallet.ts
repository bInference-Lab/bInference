import { createSecret, err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { WalletExporter } from "../install/ports.js";
import type { ExportRefusal, SealedKey } from "../install/wallet-export.js";
import type { InstallStore } from "../ports.js";
import type { EngineCall } from "./engine-call.js";

/** What an export reads the wallet from and asks custody through. */
export interface ExportWalletOptions {
  readonly install: InstallStore;
  /** Custody's export; none where custody exports no key through the engine. */
  readonly exporter?: WalletExporter;
}

const refusalCodes: Readonly<Record<ExportRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  not_found: "wallet.not_found",
  bad_recipient_key: "protocol.bad_args",
};

/**
 * Exports a wallet's private key sealed to the call's recipient key, with the owner key over IPC
 * (spec 5, section 6; decision 0131): custody seals it with HPKE, and the engine passes the sealed
 * key on and keeps it nowhere, so only the CLI that made the recipient key opens it. Any wallet
 * the install holds may be exported, archived ones too. A wallet the install does not hold is
 * `wallet.not_found`, a wrong key `wallet.bad_owner_key`, a recipient key that is none
 * `protocol.bad_args`; without custody's export it is `wallet.custody_down`.
 */
export async function exportWallet(
  options: ExportWalletOptions,
  call: EngineCall<"wallet/exportSealed">,
): Promise<Result<SealedKey, ProtocolErrorCode>> {
  const { args, signal } = call;
  const { wallets } = await options.install.read({ signal });
  const wallet = wallets.find((item) => item.id === args.wallet);
  if (wallet === undefined) {
    return err("wallet.not_found");
  }
  if (options.exporter === undefined) {
    return err("wallet.custody_down");
  }
  const request = {
    wallet: wallet.custodyWalletId,
    ownerKey: createSecret(args.ownerKey),
    recipientPublicKey: args.recipientPublicKey,
  };
  const sealed = await options.exporter.exportSealed(request, { signal });
  return sealed.ok ? ok(sealed.value) : err(refusalCodes[sealed.error]);
}
