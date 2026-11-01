import {
  type BridgeRouteDefinition,
  type ChainDefinition,
  type VenueCall,
  type VenueDeclaration,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import type { BridgeDeposit, BridgeInputs, BridgeRoute } from "./ceiling.js";
import { declaredCall } from "./declared-call.js";

// The inputs a ceiling binds: a declared empty input is the signer's alone (decision 0302).
function bridgeInputsOf(bridge: NonNullable<VenueCall["bridge"]>): BridgeInputs {
  const { recipient, destinationChain, tokenIn, tokenOut } = bridge;
  return { recipient, destinationChain, tokenIn, tokenOut };
}

/** What the ceiling takes from the registry for a chain's bridges. */
export interface BridgePlan {
  /** The routes the bridges serve from the chain, as the registry lists them. */
  readonly routes: readonly BridgeRouteDefinition[];
  /** The chains the routes may reach, as the registry defines them. */
  readonly destinations: readonly ChainDefinition[];
}

/** Why the registry gives no bridge deposit: a route names a token its chain does not list. */
export type BridgeDepositProblem = "unknown_token" | "unknown_contract" | "bad_call";

function tokenAddress(definition: ChainDefinition, symbol: string): string | undefined {
  return definition.tokens.find((token) => token.symbol === symbol)?.address;
}

// The venue's routes to one destination as token pairs; a route whose token a chain does not list
// is `unknown_token`.
function routePairs(
  source: ChainDefinition,
  destination: ChainDefinition,
  routes: readonly BridgeRouteDefinition[],
): Result<readonly BridgeRoute[], "unknown_token"> {
  const pairs: BridgeRoute[] = [];
  for (const route of routes) {
    const tokenIn = tokenAddress(source, route.leaves);
    const tokenOut = tokenAddress(destination, route.arrives);
    if (tokenIn === undefined || tokenOut === undefined) {
      return err("unknown_token");
    }
    pairs.push({ tokenIn, tokenOut });
  }
  return ok(pairs);
}

// One venue's bridge call's deposits: one per EVM destination a route of the venue reaches; a
// destination of another family, such as Solana, holds no 20-byte recipient.
function depositsOf(
  venue: VenueDeclaration,
  call: VenueCall & { readonly bridge: NonNullable<VenueCall["bridge"]> },
  source: { readonly definition: ChainDefinition; readonly plan: BridgePlan },
): Result<readonly BridgeDeposit[], BridgeDepositProblem> {
  const { definition, plan } = source;
  const declared = declaredCall(venue, definition, call);
  if (!declared.ok) {
    return declared;
  }
  const deposits: BridgeDeposit[] = [];
  for (const target of plan.destinations) {
    const routes = plan.routes.filter(
      (route) => route.venue === venue.id && route.to === target.key,
    );
    if (target.family !== "evm" || routes.length === 0) {
      continue;
    }
    const pairs = routePairs(definition, target, routes);
    if (!pairs.ok) {
      return pairs;
    }
    deposits.push({
      call: { ...declared.value, bridge: bridgeInputsOf(call.bridge) },
      destinationChainId: String(evmChainOf(target).chainId),
      routes: pairs.value,
    });
  }
  return ok(deposits);
}

/**
 * The bridge deposits of one chain from the registry (decision 0302): for each bridge deposit an
 * enabled venue declares on the chain, one per EVM destination the venue's routes reach, with
 * those routes' token pairs. Who it may pay comes from the ceiling's addresses when the ceiling is
 * written, so a destination with no saved address gets no rule. No route or a destination of
 * another family adds none. A route whose token a chain does not list, or a call that is no JSON
 * ABI entry, is an expected failure.
 */
export function registryBridgeDeposits(
  definition: ChainDefinition,
  venues: readonly { readonly venue: VenueDeclaration; readonly calls: readonly VenueCall[] }[],
  plan: BridgePlan,
): Result<readonly BridgeDeposit[], BridgeDepositProblem> {
  const deposits: BridgeDeposit[] = [];
  for (const { venue, calls } of venues) {
    for (const call of calls) {
      const { bridge } = call;
      if (bridge === undefined) {
        continue;
      }
      const made = depositsOf(venue, { ...call, bridge }, { definition, plan });
      if (!made.ok) {
        return made;
      }
      deposits.push(...made.value);
    }
  }
  return ok(deposits);
}
