import type { BridgeTarget } from "./ceiling.js";
import { callIn, type HeldRule } from "./held-rules.schema.js";

const bridgeName = /^Bridge ([A-Za-z_$][\w$]*), chain (\d{1,10}) to (\d{1,20}), ([1-9]\d{0,2})$/;

/** The addresses a ceiling's bridge rule lets a deposit from one chain pay on one destination. */
export interface HeldBridge {
  /** The EIP-155 id of the chain the deposit leaves, as decimal text. */
  readonly chainId: string;
  /** The EIP-155 id of the destination chain, as decimal text. */
  readonly destinationChainId: string;
  /** The deposit function the rule allows. */
  readonly function: string;
  readonly recipients: readonly string[];
}

// One route's rule as it names it: the conditions after its pins are, in order, the recipient,
// the destination, the token that leaves and the token that arrives. Undefined when the rule
// cannot be read so.
function routeIn(rule: HeldRule): (BridgeTarget & { readonly route: string }) | undefined {
  const named = bridgeName.exec(rule.name);
  const call = callIn(rule);
  if (named === null || call === undefined) {
    return undefined;
  }
  const prefix = `${call.abi.name}.`;
  const bound = rule.conditions.filter(
    (item) => item.field.startsWith(prefix) && item.value !== "{{wallet.address}}",
  );
  const [recipient, destination, tokenIn, tokenOut, ...rest] = bound;
  const [contract] = call.contracts;
  const parts = [recipient, destination, tokenIn, tokenOut, contract];
  if (parts.some((part) => part === undefined) || rest.length > 0) {
    return undefined;
  }
  const input = (item: { readonly field: string } | undefined) =>
    item?.field.slice(prefix.length) ?? "";
  const single = (item: typeof tokenIn) => listIn(item ?? { value: [] })[0] ?? "";
  return {
    call: {
      contract: contract ?? "",
      abi: call.abi,
      walletInputs: call.walletInputs,
      bridge: {
        recipient: input(recipient),
        destinationChain: input(destination),
        tokenIn: input(tokenIn),
        tokenOut: input(tokenOut),
      },
    },
    destinationChainId: named[3] ?? "",
    recipients: listIn(recipient ?? { value: [] }),
    routes: [{ tokenIn: single(tokenIn), tokenOut: single(tokenOut) }],
    route: named[4] ?? "",
  };
}

// The targets a chain's bridge rules name: each function's rules to one destination joined, their
// routes in the order they count, each with the same call and recipients. Undefined when a rule
// cannot be read or the rules of one destination disagree.
function targetsIn(rules: readonly HeldRule[]): readonly BridgeTarget[] | undefined {
  const routes = rules.map(routeIn);
  if (routes.some((route) => route === undefined)) {
    return undefined;
  }
  const targets: BridgeTarget[] = [];
  for (const route of routes.flatMap((item) => (item === undefined ? [] : [item]))) {
    const { route: count, ...target } = route;
    const lane = targets.findIndex(
      (item) =>
        item.call.abi.name === target.call.abi.name &&
        item.destinationChainId === target.destinationChainId,
    );
    const held = targets[lane];
    if (held === undefined) {
      if (count !== "1") {
        return undefined;
      }
      targets.push(target);
      continue;
    }
    const same =
      JSON.stringify({ ...held, routes: [] }) === JSON.stringify({ ...target, routes: [] });
    if (!same || count !== String(held.routes.length + 1)) {
      return undefined;
    }
    targets[lane] = { ...held, routes: [...held.routes, ...target.routes] };
  }
  return targets;
}

function listIn(item: { readonly value: string | readonly string[] }): readonly string[] {
  return typeof item.value === "string" ? [item.value] : item.value;
}

function bridgeRulesOf(read: readonly HeldRule[], chainId?: string): readonly HeldRule[] {
  return read.filter((rule) => {
    const named = bridgeName.exec(rule.name);
    return named !== null && (chainId === undefined || named[2] === chainId);
  });
}

/**
 * The bridge targets a chain's rules name (decision 0302): each function's route rules to one
 * destination joined, their routes in the order they count. Undefined when a bridge rule cannot be
 * read, or the rules of one destination disagree on the call or the recipients.
 */
export function heldTargetsOf(
  read: readonly HeldRule[],
  chainId: string,
): readonly BridgeTarget[] | undefined {
  return targetsIn(bridgeRulesOf(read, chainId));
}

/**
 * Each chain the bridge rules leave from, with its bridge targets as {@link heldTargetsOf} reads
 * them, in the order the rules name the chains. Undefined when a chain's bridge rules cannot be read.
 */
export function heldBridgeChainsOf(
  read: readonly HeldRule[],
): readonly { readonly chainId: string; readonly targets: readonly BridgeTarget[] }[] | undefined {
  const chainIds = [
    ...new Set(bridgeRulesOf(read).map((rule) => bridgeName.exec(rule.name)?.[2] ?? "")),
  ];
  const chains = chainIds.map((chainId) => ({ chainId, targets: heldTargetsOf(read, chainId) }));
  return chains.every((chain) => chain.targets !== undefined)
    ? chains.map(({ chainId, targets }) => ({ chainId, targets: targets ?? [] }))
    : undefined;
}

/** Whether a rule's name is a bridge rule's (decision 0302). */
export function isBridgeRuleName(name: string): boolean {
  return bridgeName.test(name);
}

/**
 * Each chain's bridge targets as the held bridges a ceiling's read-back names; a chain whose bridge
 * rules cannot be read gives none.
 */
export function heldBridgesOf(
  read: readonly HeldRule[],
  chainIds: readonly string[],
): readonly HeldBridge[] {
  return chainIds.flatMap((chainId) =>
    (heldTargetsOf(read, chainId) ?? []).map((target) => ({
      chainId,
      destinationChainId: target.destinationChainId,
      function: target.call.abi.name,
      recipients: target.recipients,
    })),
  );
}
