import type { HpkeUse } from "../hpke/hpke-seal.js";

/**
 * How a backup's data key is sealed to the owner key (keys spec, section 7.2): HPKE in base mode
 * on DHKEM P-256, HKDF-SHA256 and AES-256-GCM, with an `info` that names the format, so a key
 * sealed for anything else, such as a wallet export, never opens as a backup's.
 */
export const backupKeySuite: HpkeUse = { aead: "aes-256-gcm", info: "binference-backup v2" };
