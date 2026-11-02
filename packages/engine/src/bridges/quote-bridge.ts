import { err, ok, type Result } from "@binference/core";
import type {
  ArgsOf,
  BridgeRequest,
  BridgeTarget,
  ProtocolErrorCode,
  ResultOf,
} from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { AgentStore } from "../ports.js";
import {
  type BridgeQuoteParts,
  type ChosenBridge,
  quoteRoutes,
  routeWeightOf,
} from "./choose-bridge.js";
import { type BridgeResolveOptions, rescuePayee, resolveBridge } from "./resolve-bridge.js";

/** What a bridge quote reads: the agents, and what a bridge's proposal resolves and quotes with. */
export interface BridgeQuoteOptions extends BridgeResolveOptions, BridgeQuoteParts {
  readonly agents: Pick<AgentStore, "get">;
}

type Quotes = ResultOf<"bridge/quote">;
type RouteView = Quotes["items"][number];

interface Call {
  readonly signal: AbortSignal;
}

/**
 * Whom a quote with no recipient is priced for (decision 0330): the rescue address on the
 * destination when the agent's bridge rules joined it there after its plain-wallet check, or the
 * saved address that is the rescue address on that chain; else `address.no_recipient`, which tells
 * the agent to ask the owner which saved address to use.
 */
async function defaultTarget(
  options: BridgeQuoteOptions,
  asked: { readonly settings: AgentSettings; readonly args: ArgsOf<"bridge/quote"> },
  call: Call,
): Promise<Result<BridgeTarget, ProtocolErrorCode>> {
  const { settings, args } = asked;
  const destination = options.destinations.find((item) => item.ref === args.toChain);
  if (destination === undefined) {
    return err("protocol.bad_args");
  }
  const facts = await options.install.read(call);
  const payee = rescuePayee(options, facts, destination);
  if (!payee.ok) {
    return err("address.no_recipient");
  }
  const { account } = payee.value;
  const isJoined = (facts.rescueReach ?? []).some(
    (reach) =>
      reach.agent === settings.agent.id && reach.account === account && reach.state === "joined",
  );
  const saved = settings.addressBook.find((entry) => entry.account === account);
  if (isJoined) {
    return ok({ rescue: true });
  }
  return saved === undefined ? err("address.no_recipient") : ok({ entry: saved.id });
}

// The best least output first; equal ones keep their routes' order.
function byWeight(left: ChosenBridge, right: ChosenBridge): number {
  const [a, b] = [routeWeightOf(left), routeWeightOf(right)];
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function viewOf(chosen: ChosenBridge, toChain: RouteView["toChain"]): RouteView {
  const { candidate, request, quote } = chosen;
  return {
    venue: candidate.hosted.bridge.id,
    toChain,
    sentAsset: request.amountIn.asset,
    deliveredAsset: quote.minOut.asset,
    amountIn: request.amountIn,
    expectedOut: quote.expectedOut,
    minOut: quote.minOut,
    fees: quote.fees.map(({ kind, amount }) => ({ kind, amount })),
    etaSeconds: quote.etaSeconds,
    quotedAt: quote.quotedAtMs,
    expiresAt: quote.expiresAtMs,
  };
}

/**
 * Quotes a bridge for the agent without storing anything (protocol spec, section 7.3): the request
 * resolved as a proposal resolves it, every route the wallet may take quoted and held to the same
 * checks, and each route that quoted answered, the best least output first. With no `to`, the
 * route is priced for the default recipient of decision 0330. An unknown agent is
 * `agent.not_found`; the resolution's refusals are its own; no route left is `quote.no_route`,
 * or `quote.venue_down` when every route's venue did not answer. Paper agents quote too.
 */
export async function quoteBridge(
  options: BridgeQuoteOptions,
  args: ArgsOf<"bridge/quote">,
  call: Call,
): Promise<Result<Quotes, ProtocolErrorCode>> {
  const settings = await options.agents.get(args.agent, call);
  if (settings === undefined) {
    return err("agent.not_found");
  }
  const target =
    args.to === undefined ? await defaultTarget(options, { settings, args }, call) : ok(args.to);
  if (!target.ok) {
    return target;
  }
  const { to: _to, ...asked } = args;
  const request: BridgeRequest = { ...asked, kind: "bridge", reason: "quote", to: target.value };
  const isPaper = settings.agent.mode === "paper";
  const resolved = await resolveBridge(options, { request, settings, isPaper, ...call });
  if (!resolved.ok) {
    return resolved;
  }
  const quoted = await quoteRoutes(options, resolved.value, call.signal);
  const taken = quoted.flatMap((route) => (route.ok ? [route.value] : [])).toSorted(byWeight);
  if (taken.length === 0) {
    const isDown =
      quoted.length > 0 && quoted.every((route) => !route.ok && route.error === "venue_down");
    return err(isDown ? "quote.venue_down" : "quote.no_route");
  }
  const items = taken.map((chosen) => viewOf(chosen, args.toChain));
  const named = items.flatMap((item) => [item.sentAsset, item.deliveredAsset]);
  return ok({ items, assets: assetInfosOf(options.chains, [...new Set(named)]) });
}
