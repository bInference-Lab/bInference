import type { HpkeUse } from "../hpke/hpke-seal.js";
import type { BackupVersion } from "./backup-header.schema.js";

/**
 * How a backup's data key is sealed (keys spec, section 7.2): HPKE in base mode on DHKEM P-256,
 * HKDF-SHA256 and AES-256-GCM, with an `info` that names the format and its version, so a key
 * sealed for anything else, such as a wallet export, or for the other version, never opens as
 * this one's. Version 2 seals to the owner key, version 3 to the sealing key it derives.
 */
export function backupKeySuite(version: BackupVersion): HpkeUse {
  return { aead: "aes-256-gcm", info: `binference-backup v${String(version)}` };
}
