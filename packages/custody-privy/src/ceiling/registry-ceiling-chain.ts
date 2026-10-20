import {
  type ChainDefinition,
  type ChainRef,
  declaredAddress,
  declaredContracts,
  type VenueContracts,
  type VenueDeclaration,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { CeilingCall, CeilingChainPlan, LaunchCall, LaunchCeiling } from "./ceiling.js";

/** What the ceiling takes from the registry for one chain. */
export interface RegistryCeilingRequest {
  /** The chain as the registry defines it; an EVM chain. */
  readonly definition: ChainDefinition;
  /** The declarations of the venues the owner enabled for the agent. */
  readonly venues: readonly VenueDeclaration[];
  /** The most native coin, in base units, one contract call may send. */
  readonly perTxNativeCapBase: bigint;
  /**
   * The ceiling is a launch wallet's: it also allows the calls only a launch wallet makes, such
   * as a launchpad's create call (decision 0271). Absent, an agent wallet's.
   */
  readonly isLaunch?: boolean;
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

// A launch's contracts are made per launch, so no list can hold them: they add nothing here
// (decision 0212).
function isRegistryName(declared: Declared, name: string): boolean {
  return declared.contracts.launchContracts?.includes(name) !== true;
}

function callsOf(
  declared: Declared,
  ceiling: { readonly definition: ChainDefinition; readonly isLaunch: boolean },
): Result<readonly CeilingCall[], RegistryCeilingProblem> {
  const { definition } = ceiling;
  const calls: CeilingCall[] = [];
  // A call the venue never builds is declared only for the signer's refusal: no ceiling lists it.
  const listed = (declared.contracts.calls ?? []).filter(
    (call) =>
      isRegistryName(declared, call.contract) &&
      call.isUnbuilt !== true &&
      (ceiling.isLaunch || call.isLaunchWalletOnly !== true),
  );
  for (const call of listed) {
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

// The spenders a ceiling allows: a launch wallet's also those only it may approve (decision 0277).
function spendersOf(
  declared: Declared,
  ceiling: { readonly definition: ChainDefinition; readonly isLaunch: boolean },
): Result<readonly string[], "unknown_contract"> {
  const { definition } = ceiling;
  const spenders: string[] = [];
  const launchOnly = ceiling.isLaunch ? (declared.contracts.launchWalletSpenders ?? []) : [];
  const listed = [...(declared.contracts.spenders ?? []), ...launchOnly].filter((name) =>
    isRegistryName(declared, name),
  );
  for (const name of listed) {
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
 * contracts it names as spenders, each read from the chain definition by name. A call only a launch
 * wallet makes is in a launch wallet's ceiling alone (decision 0271), as is a spender only it
 * approves (decision 0277). A venue that declares nothing on the chain adds nothing. A name the definition does not hold, or a call that is no JSON ABI entry,
 * is an expected failure, so a ceiling never allows less, or more, than the venues use. A call
 * or a spender on a contract each launch makes, such as a launchpad's curve, adds nothing: no
 * address list can hold one, so such trades stay outside every ceiling (decision 0212).
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
    const ceiling = { definition: request.definition, isLaunch: request.isLaunch === true };
    const venueCalls = declared === undefined ? ok([]) : callsOf(declared, ceiling);
    const venueSpenders = declared === undefined ? ok([]) : spendersOf(declared, ceiling);
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

// The calls one venue declares on its launch contracts on a chain, and whether it names one as a
// spender; a call that is no JSON ABI entry is `bad_call`.
function launchPartsOf(
  contracts: VenueContracts,
): Result<{ readonly calls: readonly LaunchCall[]; readonly approves: boolean }, "bad_call"> {
  const launched = new Set(contracts.launchContracts ?? []);
  const calls: LaunchCall[] = [];
  for (const call of (contracts.calls ?? []).filter((item) => launched.has(item.contract))) {
    const abi = abiFunctionSchema.safeParse(call.abi);
    if (!abi.success) {
      return err("bad_call");
    }
    calls.push({ abi: abi.data, walletInputs: call.walletInputs });
  }
  const approves = (contracts.spenders ?? []).some((name) => launched.has(name));
  return ok({ calls, approves });
}

/**
 * What a launch wallet's ceiling adds on one chain (decision 0217): each call the venues given
 * declare on the contracts each of their launches makes, with its JSON ABI and the inputs it pins
 * to the wallet, and whether one names such a contract as a spender. No launch contract declared on
 * the chain adds nothing. A call that is no JSON ABI entry is `bad_call`; one that pins no input is
 * refused when the ceiling is built.
 */
export function launchCeilingOf(
  chain: ChainRef,
  venues: readonly VenueDeclaration[],
): Result<LaunchCeiling | undefined, "bad_call"> {
  const calls: LaunchCall[] = [];
  let approvesAnySpender = false;
  for (const venue of venues) {
    const contracts = venue.contracts.find((item) => item.chain === chain);
    const parts =
      contracts === undefined ? ok({ calls: [], approves: false }) : launchPartsOf(contracts);
    if (!parts.ok) {
      return parts;
    }
    calls.push(...parts.value.calls);
    approvesAnySpender ||= parts.value.approves;
  }
  return ok(calls.length === 0 && !approvesAnySpender ? undefined : { calls, approvesAnySpender });
}
