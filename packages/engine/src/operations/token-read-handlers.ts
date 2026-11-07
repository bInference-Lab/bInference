import {
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
} from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode, RiskView } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import {
  quoteBestTrade,
  quoteRequest,
  type QuoteRequestOptions,
} from "../money-path/quote-request.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { ReadTokenFacts } from "../money-path/token-facts.js";
import type { AgentStore, RiskCheck } from "../ports.js";
import type { EngineHandler } from "./engine-call.js";

/** The handlers of `asset/get`, `quote/get` and `risk/check` (protocol spec, section 7.3). */
export interface TokenReadHandlers {
  readonly "asset/get": EngineHandler<"asset/get">;
  readonly "quote/get": EngineHandler<"quote/get">;
  readonly "risk/check": EngineHandler<"risk/check">;
}

/** What the token reads take: the agents, the chains, the token facts and what a quote needs. */
export interface TokenReadOptions {
  readonly agents: AgentStore;
  readonly chains: ChainRegistry;
  readonly readTokenFacts: ReadTokenFacts;
  readonly quotes: QuoteRequestOptions;
  /** The money path's risk step, which `risk/check` runs on a sample buy. */
  readonly risk: RiskCheck;
}

// The sample buy `risk/check` quotes: one hundredth of a whole coin of the token's chain.
const sampleShareDigits = 2;

function assetGet(options: TokenReadOptions): EngineHandler<"asset/get"> {
  return async ({ args, signal }) => {
    const canonical = canonicalAsset(options.chains, args.asset);
    if (!canonical.ok) {
      return err("protocol.bad_args");
    }
    const asset = canonical.value;
    const listed = assetInfoOf(options.chains, asset);
    if (listed !== undefined) {
      return ok({ asset, ...listed });
    }
    const facts = (await options.readTokenFacts([asset], { signal })).get(asset);
    return facts === undefined ? err("asset.unreadable") : ok({ asset, ...facts, verified: false });
  };
}

function quoteGet(options: TokenReadOptions): EngineHandler<"quote/get"> {
  return async ({ args, signal }) => {
    const settings = await options.agents.get(args.agent, { signal });
    if (settings === undefined) {
      return err("agent.not_found");
    }
    return quoteRequest(options.quotes, { request: args, settings }, signal);
  };
}

// The agent a risk check quotes for: the one it names, or the oldest one not archived.
async function riskAgentOf(
  options: TokenReadOptions,
  named: Id<"agt"> | undefined,
  signal: AbortSignal,
): Promise<AgentSettings | undefined> {
  const agent =
    named ??
    (await options.agents.list({ signal })).find((each) => each.archivedAtMs === undefined)?.id;
  return agent === undefined ? undefined : options.agents.get(agent, { signal });
}

// A buy of the token for a sample of its chain's coin, which the risk check's round trip mirrors.
function sampleBuy(chain: RegisteredChain, token: AssetRef, agent: Id<"agt">): IntentRequest {
  const { decimals } = chain.definition.nativeAsset;
  const base = 10n ** BigInt(Math.max(decimals - sampleShareDigits, 0));
  const spend = { asset: nativeAssetOf(chain), base };
  return { kind: "buy", agent, token, spend, reason: "Risk check" };
}

// Runs the money path's risk step on the sample buy's best venue quote, with the agent's limits.
async function assessSample(
  options: TokenReadOptions,
  asked: {
    readonly chain: RegisteredChain;
    readonly token: AssetRef;
    readonly settings: AgentSettings;
  },
  signal: AbortSignal,
): Promise<Result<RiskView, ProtocolErrorCode>> {
  const { chain, token, settings } = asked;
  const request = sampleBuy(chain, token, settings.agent.id);
  const best = await quoteBestTrade(options.quotes, { request, settings }, signal);
  if (!best.ok) {
    return best;
  }
  const { taxBps, liquidityFloorUsdMicros } = settings.limits;
  const limits = { maxTaxBps: taxBps, liquidityFloorUsdMicros };
  const assessed = await options.risk.assess({ quoted: best.value.quoted, limits }, { signal });
  return ok(assessed.view);
}

function riskCheck(options: TokenReadOptions): EngineHandler<"risk/check"> {
  return async ({ args, signal }) => {
    const { chains } = options;
    const canonical = canonicalAsset(chains, args.asset);
    const chain = canonical.ok ? chains.get(assetRefParts(canonical.value).chain) : undefined;
    if (!canonical.ok || chain?.ok !== true) {
      return err("protocol.bad_args");
    }
    const settings = await riskAgentOf(options, args.agent, signal);
    if (settings === undefined) {
      return err("agent.not_found");
    }
    const token = canonical.value;
    return assessSample(options, { chain: chain.value, token, settings }, signal);
  };
}

/**
 * Creates the token reads. `asset/get` answers a token as the registry lists it, or as its
 * contract answers on chain, unverified, when the registry does not list it; a token on no chain of
 * the registry is `protocol.bad_args`, and one that answers no symbol or decimals
 * `asset.unreadable`. `quote/get` quotes a request as its proposal would be quoted and stores
 * nothing (see `quoteRequest`); an unknown agent is `agent.not_found`. `risk/check` quotes a
 * sample buy of the token for a hundredth of its chain's coin from the agent's wallet in its mode,
 * the oldest agent not archived when the call names none, and runs the money path's risk step on
 * that quote with the agent's limits (decision 0379): a token the registry lists passes, any other
 * gets its sources, its round trip and its verdict. No route for the sample is `quote.no_route`.
 */
export function createTokenReadHandlers(options: TokenReadOptions): TokenReadHandlers {
  return {
    "asset/get": assetGet(options),
    "quote/get": quoteGet(options),
    "risk/check": riskCheck(options),
  };
}
