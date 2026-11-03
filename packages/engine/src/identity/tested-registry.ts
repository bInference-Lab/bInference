import { type ChainFamily, isSameAccount } from "@binference/chain";
import type { IdentityRegistry, IdentityStanding } from "@binference/chain/identity";

/**
 * Whether the registry runs as binference tested it (decision 0335): it reports the version its
 * plugin was tested with, and its proxy runs the contract the chain registry pins, when it pins
 * one, as the chain's family compares accounts. An upgrade that kept the version string fails.
 */
export function isTestedRegistry(
  registry: Pick<IdentityRegistry, "testedVersion" | "testedImplementation">,
  standing: IdentityStanding,
  family: ChainFamily,
): boolean {
  const tested = registry.testedImplementation;
  const runs = standing.implementation;
  return (
    standing.version === registry.testedVersion &&
    (tested === undefined || (runs !== undefined && isSameAccount(runs, tested, family)))
  );
}
