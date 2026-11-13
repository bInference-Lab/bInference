import { noBreaker, noQuotas } from "@binference/engine";
import type { CliHost } from "../program/cli-host.js";
import type { ComposedCustody } from "./compose-custody.js";
import type { EngineParts } from "./profile-parts.js";

/**
 * The parts this machine's owner gives the engine: custody, from the custody cell that the lock
 * opens, no quota (decision 0431) and no breaker (decision 0439), but the one a test's host sets.
 */
export function ownPartsOf(
  custody: ComposedCustody,
  host: Pick<CliHost, "testBreaker">,
): Omit<EngineParts, "stores" | "prices" | "riskSources" | "marketReads"> {
  const { signer, ceilings, walletMaker, exporter, revoker } = custody.cell;
  const quotas = noQuotas;
  const breaker = host.testBreaker ?? noBreaker;
  return { custody: signer, ceilings, walletMaker, exporter, revoker, quotas, breaker };
}
