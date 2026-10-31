import {
  type ChainDefinition,
  type ChainRef,
  declaredAddress,
  declaredContracts,
  type VenueCall,
  type VenueContracts,
  type VenueDeclaration,
  type WalletRole,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { CeilingCall, CeilingChainPlan, LaunchCall, LaunchCeiling } from "./ceiling.js";
import { type BridgePlan, registryBridgeDeposits } from "./registry-bridge-deposits.js";

/** What the ceiling takes from the registry for one chain. */
export interface RegistryCeilingRequest {
  /** The chain as the registry defines it; an EVM chain. */
  readonly definition: ChainDefinition;
  /** The declarations of the venues the owner enabled for the agent. */
  readonly venues: readonly VenueDeclaration[];
  /** The most native coin, in base units, one contract call may send. */
  readonly perTxNativeCapBase: bigint;
  /**
   * The role of the wallet whose ceiling this is: it also allows the calls only a wallet of that
   * role makes, such as a launchpad's create call, a launch wallet's (decision 0271). Absent, an
   * agent wallet's.
   */
  readonly role?: WalletRole;
  /**
   * The routes and the saved addresses a bridge deposit may reach from the chain (decision 0302);
   * absent, no bridge target, so no bridge deposit is allowed.
   */
  readonly bridges?: BridgePlan;
}

/**
 * Why the registry gives no ceiling for a chain: a venue names a contract the chain's entry does
 * not list for it, or declares a call whose function is no JSON ABI entry.
 */
export type RegistryCeilingProblem = "unknown_contract" | "bad_call" | "unknown_token";

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
  ceiling: { readonly definition: ChainDefinition; readonly role: WalletRole | undefined },
): Result<readonly CeilingCall[], RegistryCeilingProblem> {
  const { definition } = ceiling;
  const calls: CeilingCall[] = [];
  // A call the venue never builds is declared only for the signer's refusal: no ceiling lists it.
  const listed = (declared.contracts.calls ?? []).filter(
    (call) =>
      isRegistryName(declared, call.contract) &&
      call.isUnbuilt !== true &&
      call.bridge === undefined &&
      (call.onlyWallet === undefined || call.onlyWallet === ceiling.role),
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

// The spenders a ceiling allows: a role's wallet also those only it may approve (decision 0277).
function spendersOf(
  declared: Declared,
  ceiling: { readonly definition: ChainDefinition; readonly role: WalletRole | undefined },
): Result<readonly string[], "unknown_contract"> {
  const { definition } = ceiling;
  const spenders: string[] = [];
  const roleOnly =
    ceiling.role === undefined ? [] : (declared.contracts.onlyWalletSpenders?.[ceiling.role] ?? []);
  const listed = [...(declared.contracts.spenders ?? []), ...roleOnly].filter((name) =>
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

// What one venue adds on the chain: its plain calls and spenders, and every call it declares there.
function venuePartsOf(
  venue: VenueDeclaration,
  request: RegistryCeilingRequest,
): Result<
  {
    readonly calls: readonly CeilingCall[];
    readonly spenders: readonly string[];
    readonly declared: readonly VenueCall[];
  },
  RegistryCeilingProblem
> {
  const ref = evmChainOf(request.definition).ref;
  const named = declaredContracts(venue, { ref, definition: request.definition });
  if (!named.ok) {
    return named;
  }
  const contracts = venue.contracts.find((item) => item.chain === ref);
  if (contracts === undefined) {
    return ok({ calls: [], spenders: [], declared: [] });
  }
  const declared = { venue, contracts };
  const ceiling = { definition: request.definition, role: request.role };
  const calls = callsOf(declared, ceiling);
  const spenders = spendersOf(declared, ceiling);
  if (!calls.ok) {
    return calls;
  }
  return spenders.ok
    ? ok({ calls: calls.value, spenders: spenders.value, declared: contracts.calls ?? [] })
    : spenders;
}

/**
 * The ceiling's view of one chain from the registry (decision 0149), before its 24-hour caps:
 * the functions each enabled venue declares its trades call, on the contracts it names, and the
 * contracts it names as spenders, each read from the chain definition by name. A call only a launch
 * wallet makes is in a launch wallet's ceiling alone (decision 0271), as is a spender only it
 * approves (decision 0277). A venue that declares nothing on the chain adds nothing. A name the definition does not hold, or a call that is no JSON ABI entry,
 * is an expected failure, so a ceiling never allows less, or more, than the venues use. A call
 * or a spender on a contract each launch makes, such as a launchpad's curve, adds nothing: no
 * address list can hold one, so such trades stay outside every ceiling (decision 0212). A bridge
 * deposit a venue declares is no plain call: it becomes the targets `bridges` plans (decision 0302),
 * and none without a plan. A route whose token a chain does not list is `unknown_token`.
 */
export function registryCeilingChain(
  request: RegistryCeilingRequest,
): Result<CeilingChainPlan, RegistryCeilingProblem> {
  const chain = evmChainOf(request.definition);
  const calls: CeilingCall[] = [];
  const spenders: string[] = [];
  const bridging: { readonly venue: VenueDeclaration; readonly calls: readonly VenueCall[] }[] = [];
  for (const venue of request.venues) {
    const parts = venuePartsOf(venue, request);
    if (!parts.ok) {
      return parts;
    }
    calls.push(...parts.value.calls);
    spenders.push(...parts.value.spenders);
    bridging.push({ venue, calls: parts.value.declared });
  }
  const targets =
    request.bridges === undefined
      ? ok([])
      : registryBridgeDeposits(request.definition, bridging, request.bridges);
  if (!targets.ok) {
    return targets;
  }
  const { perTxNativeCapBase } = request;
  const extras = targets.value.length === 0 ? {} : { bridges: targets.value };
  return ok({ chain, calls, spenders: [...new Set(spenders)], perTxNativeCapBase, ...extras });
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
