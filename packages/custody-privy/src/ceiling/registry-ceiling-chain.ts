import {
  type ChainDefinition,
  declaredAddress,
  declaredContracts,
  type VenueContracts,
  type VenueDeclaration,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { CeilingCall, CeilingChainPlan } from "./ceiling.js";

/** What the ceiling takes from the registry for one chain. */
export interface RegistryCeilingRequest {
  /** The chain as the registry defines it; an EVM chain. */
  readonly definition: ChainDefinition;
  /** The declarations of the venues the owner enabled for the agent. */
  readonly venues: readonly VenueDeclaration[];
  /** The most native coin, in base units, one contract call may send. */
  readonly perTxNativeCapBase: bigint;
}

/**
 * Why the registry gives no ceiling for a chain: a venue names a contract the chain's entry does
 * not list for it, or declares a call whose function is no JSON ABI entry.
 */
export type RegistryCeilingProblem = "unknown_contract" | "bad_call";

/** A venue and what it declares on one chain. */
interface Declared {
  readonly venue: VenueDeclaration;
  readonly contracts: VenueContracts;
}

function callsOf(
  declared: Declared,
  definition: ChainDefinition,
): Result<readonly CeilingCall[], RegistryCeilingProblem> {
  const calls: CeilingCall[] = [];
  for (const call of declared.contracts.calls ?? []) {
    const contract = declaredAddress(declared.venue, { definition }, call.contract);
    const abi = abiFunctionSchema.safeParse(call.abi);
    if (!contract.ok) {
      return contract;
    }
    if (!abi.success) {
      return err("bad_call");
    }
    calls.push({ contract: contract.value, abi: abi.data, walletInputs: call.walletInputs });
  }
  return ok(calls);
}

function spendersOf(
  declared: Declared,
  definition: ChainDefinition,
): Result<readonly string[], "unknown_contract"> {
  const spenders: string[] = [];
  for (const name of declared.contracts.spenders ?? []) {
    const address = declaredAddress(declared.venue, { definition }, name);
    if (!address.ok) {
      return address;
    }
    spenders.push(address.value);
  }
  return ok(spenders);
}

/**
 * The ceiling's view of one chain from the registry (decision 0149), before its 24-hour caps:
 * the functions each enabled venue declares its trades call, on the contracts it names, and the
 * contracts it names as spenders, each read from the chain definition by name. A venue that declares nothing on the
 * chain adds nothing. A name the definition does not hold, or a call that is no JSON ABI entry,
 * is an expected failure, so a ceiling never allows less, or more, than the venues use.
 */
export function registryCeilingChain(
  request: RegistryCeilingRequest,
): Result<CeilingChainPlan, RegistryCeilingProblem> {
  const chain = evmChainOf(request.definition);
  const calls: CeilingCall[] = [];
  const spenders: string[] = [];
  for (const venue of request.venues) {
    const named = declaredContracts(venue, { ref: chain.ref, definition: request.definition });
    if (!named.ok) {
      return named;
    }
    const contracts = venue.contracts.find((item) => item.chain === chain.ref);
    const declared = contracts === undefined ? undefined : { venue, contracts };
    const venueCalls = declared === undefined ? ok([]) : callsOf(declared, request.definition);
    const venueSpenders =
      declared === undefined ? ok([]) : spendersOf(declared, request.definition);
    if (!venueCalls.ok) {
      return venueCalls;
    }
    if (!venueSpenders.ok) {
      return venueSpenders;
    }
    calls.push(...venueCalls.value);
    spenders.push(...venueSpenders.value);
  }
  const { perTxNativeCapBase } = request;
  return ok({ chain, calls, spenders: [...new Set(spenders)], perTxNativeCapBase });
}
