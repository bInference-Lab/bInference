import {
  type ChainDefinition,
  declaredAddress,
  type VenueCall,
  type VenueDeclaration,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { CeilingCall } from "./ceiling.js";

/**
 * A venue's declared call as a ceiling rule needs it: the address of its contract on the chain and
 * its function as a JSON ABI entry. A contract the chain does not list is `unknown_contract`; a
 * function that is no JSON ABI entry is `bad_call`.
 */
export function declaredCall(
  venue: Pick<VenueDeclaration, "id">,
  definition: ChainDefinition,
  call: Pick<VenueCall, "contract" | "abi" | "walletInputs">,
): Result<CeilingCall, "unknown_contract" | "bad_call"> {
  const contract = declaredAddress(venue, { definition }, call.contract);
  const abi = abiFunctionSchema.safeParse(call.abi);
  if (!contract.ok) {
    return contract;
  }
  if (!abi.success) {
    return err("bad_call");
  }
  return ok({ contract: contract.value, abi: abi.data, walletInputs: call.walletInputs });
}
