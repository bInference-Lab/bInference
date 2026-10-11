import type { AssetRef, ChainDefinition } from "@binference/chain";
import { createFakeChainDefinition, createFakeVenue } from "@binference/chain/testing";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Id } from "@binference/core";
import {
  createFakePriceSource,
  testAgent,
  testCoin,
  testToken,
  testWallet,
} from "@binference/engine/testing";
import type { EngineParts } from "../compose/compose-engine.js";
import {
  type Skeleton,
  skeletonCompositions,
  skeletonSecrets,
  startSkeleton,
} from "../compose/test-skeleton.js";

/** The ids the recorded run trades with: the owner's agent and wallet, and its BNB and USDT. */
export interface SkillRunIds {
  readonly agent: Id<"agt">;
  readonly wallet: Id<"wal">;
  readonly bnb: AssetRef;
  readonly usdt: AssetRef;
}

/** The engine of the recorded run, and the MCP server's client of it. */
export interface SkillRunEngine {
  readonly ids: SkillRunIds;
  /** Signed in with the MCP token, which holds `read` and `propose` only. */
  readonly mcpClient: ProtocolClient;
  close(): Promise<void>;
}

/** The skeleton's agent, wallet, coin and token, which the run's fake chain names BNB and USDT. */
export const skillRunIds: SkillRunIds = {
  agent: testAgent,
  wallet: testWallet,
  bnb: testCoin,
  usdt: testToken,
};

const decimals = 18;
const unit = 10n ** BigInt(decimals);
// $600 a BNB and $1 a USDT, in micro-dollars for one whole unit.
const bnbPrice = { numerator: 600_000_000n, denominator: unit };
const usdtPrice = { numerator: 1_000_000n, denominator: unit };

// The fake chain under BNB Smart Chain's names: its coin is BNB and its one token USDT, with 18
// decimals as on BNB Smart Chain. The fake venue and family read only its ids.
function skillRunChain(): ChainDefinition {
  const chain = createFakeChainDefinition();
  const [token] = chain.tokens;
  if (token === undefined) {
    throw new BinferenceError({ code: "test.no_token", message: "The fake chain lists a token." });
  }
  return {
    ...chain,
    nativeAsset: { ...chain.nativeAsset, symbol: "BNB", name: "BNB", decimals },
    tokens: [{ ...token, symbol: "USDT", name: "Tether USD", decimals }],
  };
}

function selfHostedParts(): EngineParts {
  const composition = skeletonCompositions.find((item) => item.name === "self-hosted");
  if (composition === undefined) {
    throw new BinferenceError({ code: "test.no_composition", message: "No self-hosted skeleton." });
  }
  const prices = new Map([
    [skillRunIds.bnb, bnbPrice],
    [skillRunIds.usdt, usdtPrice],
  ]);
  return { ...composition.parts(), prices: createFakePriceSource(prices) };
}

/**
 * Starts the engine of the recorded run in one process: the test skeleton's self-hosted
 * composition on the fake chain named as BNB Smart Chain, with the fake venue at 600 USDT a BNB,
 * in memory stores, on paper in manual mode, its paper portfolio reset to 1 BNB and 500 USDT. No
 * chain, custody, Telegram or model is reached, and no card is ever answered.
 */
export async function startSkillRunEngine(): Promise<SkillRunEngine> {
  const skeleton: Skeleton = await startSkeleton(selfHostedParts(), {
    fakeChain: skillRunChain(),
    venues: [createFakeVenue({ rate: { numerator: 600n, denominator: 1n } })],
    paperBalances: [
      { asset: skillRunIds.bnb, base: unit },
      { asset: skillRunIds.usdt, base: 500n * unit },
    ],
  });
  const live = { signal: AbortSignal.timeout(10_000) };
  await skeleton.client.call("portfolio/resetPaper", { agent: skillRunIds.agent }, live);
  const mcpClient = await skeleton.connect(skeletonSecrets.mcp, "mcp");
  return { ids: skillRunIds, mcpClient, close: async () => skeleton.close() };
}
