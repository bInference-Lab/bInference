import { noQuotas } from "@binference/engine";
import type { ComposedCustody } from "./compose-custody.js";
import type { EngineParts } from "./profile-parts.js";

/**
 * The parts this machine's owner gives the engine: custody, from the custody cell that the lock
 * opens, and no quota (decision 0431).
 */
export function ownPartsOf(
  custody: ComposedCustody,
): Pick<EngineParts, "custody" | "ceilings" | "walletMaker" | "exporter" | "revoker" | "quotas"> {
  const { signer, ceilings, walletMaker, exporter, revoker } = custody.cell;
  return { custody: signer, ceilings, walletMaker, exporter, revoker, quotas: noQuotas };
}
