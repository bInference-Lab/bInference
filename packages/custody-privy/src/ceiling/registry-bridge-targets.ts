import {
  type BridgeRouteDefinition,
  type ChainDefinition,
  declaredAddress,
  type VenueCall,
  type VenueDeclaration,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { abiFunctionSchema } from "./abi-function.schema.js";
import type { BridgeInputs, BridgeTarget } from "./ceiling.js";

// The inputs a ceiling binds: a declared empty input is the signer's alone (decision 0302).
function bridgeInputsOf(bridge: NonNullable<VenueCall["bridge"]>): BridgeInputs {
  const { recipient, destinationChain, tokenIn, tokenOut } = bridge;
  return { recipient, destinationChain, tokenIn, tokenOut };
}

/** A destination chain, and the addresses the owner saved for it (decision 0302). */
export interface BridgeDestination {
  /** The destination chain as the registry defines it. */
  readonly definition: ChainDefinition;
  /**
   * The 20-byte addresses a deposit may pay there: the entries saved for this chain, and the
   * rescue address where it is a plain wallet on both chains (decision 0297).
   */
  readonly recipients: readonly string[];
}

/** What the ceiling takes from the registry and the address book for a chain's bridges. */
export interface BridgePlan {
  /** The routes the bridges serve from the chain, as the registry lists them. */
  readonly routes: readonly BridgeRouteDefinition[];
  readonly destinations: readonly BridgeDestination[];
}

/** Why the registry gives no bridge target: a route names a token its chain does not list. */
export type BridgeTargetProblem = "unknown_token" | "unknown_contract" | "bad_call";

function known(list: readonly (string | undefined)[]): readonly string[] {
  return list.flatMap((item) => (item === undefined ? [] : [item]));
}

function tokenAddress(definition: ChainDefinition, symbol: string): string | undefined {
  return definition.tokens.find((token) => token.symbol === symbol)?.address;
}

// The tokens the venue's routes to one destination take and deliver, each once.
function routeTokens(
  source: ChainDefinition,
  destination: ChainDefinition,
  routes: readonly BridgeRouteDefinition[],
): Result<
  { readonly tokensIn: readonly string[]; readonly tokensOut: readonly string[] },
  "unknown_token"
> {
  const tokensIn = routes.map((route) => tokenAddress(source, route.leaves));
  const tokensOut = routes.map((route) => tokenAddress(destination, route.arrives));
  if (known(tokensIn).length !== routes.length || known(tokensOut).length !== routes.length) {
    return err("unknown_token");
  }
  return ok({ tokensIn: [...new Set(known(tokensIn))], tokensOut: [...new Set(known(tokensOut))] });
}

// One venue's bridge call's targets: one per EVM destination with a saved address and a route of the
// venue; a destination of another family, such as Solana, holds no 20-byte recipient.
function targetsOf(
  venue: VenueDeclaration,
  call: VenueCall & { readonly bridge: NonNullable<VenueCall["bridge"]> },
  source: { readonly definition: ChainDefinition; readonly plan: BridgePlan },
): Result<readonly BridgeTarget[], BridgeTargetProblem> {
  const { definition, plan } = source;
  const contract = declaredAddress(venue, { definition }, call.contract);
  const abi = abiFunctionSchema.safeParse(call.abi);
  if (!contract.ok) {
    return contract;
  }
  if (!abi.success) {
    return err("bad_call");
  }
  const targets: BridgeTarget[] = [];
  for (const destination of plan.destinations) {
    const target = destination.definition;
    const routes = plan.routes.filter(
      (route) => route.venue === venue.id && route.to === target.key,
    );
    if (target.family !== "evm" || routes.length === 0 || destination.recipients.length === 0) {
      continue;
    }
    const tokens = routeTokens(definition, target, routes);
    if (!tokens.ok) {
      return tokens;
    }
    const bridgeCall = { contract: contract.value, abi: abi.data, walletInputs: call.walletInputs };
    targets.push({
      call: { ...bridgeCall, bridge: bridgeInputsOf(call.bridge) },
      destinationChainId: String(evmChainOf(target).chainId),
      recipients: destination.recipients,
      ...tokens.value,
    });
  }
  return ok(targets);
}

/**
 * The bridge targets of one chain from the registry and the address book (decision 0302): for each
 * bridge deposit an enabled venue declares on the chain, one target per EVM destination the venue's
 * routes reach and the owner saved an address for, with the tokens those routes take and deliver.
 * No saved address, no route or a destination of another family adds none, so a ceiling never
 * lets a deposit pay where nothing binds it. A route whose token a chain does not list, or a call
 * that is no JSON ABI entry, is an expected failure.
 */
export function registryBridgeTargets(
  definition: ChainDefinition,
  venues: readonly { readonly venue: VenueDeclaration; readonly calls: readonly VenueCall[] }[],
  plan: BridgePlan,
): Result<readonly BridgeTarget[], BridgeTargetProblem> {
  const targets: BridgeTarget[] = [];
  for (const { venue, calls } of venues) {
    for (const call of calls) {
      const { bridge } = call;
      if (bridge === undefined) {
        continue;
      }
      const made = targetsOf(venue, { ...call, bridge }, { definition, plan });
      if (!made.ok) {
        return made;
      }
      targets.push(...made.value);
    }
  }
  return ok(targets);
}
