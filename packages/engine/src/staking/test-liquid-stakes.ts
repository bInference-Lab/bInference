import { type AssetRef, assetRefSchema, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLiquidStakingVenue,
  createFakeSigningScheme,
  type FakeLiquidStakingVenue,
} from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import type { StakeRequest } from "@binference/protocol";
import { testAgent, testLimits, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { halfCoin, testUnbondingSeconds } from "./test-stakes.js";

/** The fake liquid staking venue's id, which the test agent may use. */
const testLiquidVenue = "fake-liquid";

/** The fake pool's receipt token. */
export const testPoolReceipt: AssetRef = assetRefSchema.parse("fake:1/token:0x000000e2");

/** The fake pool, named Pool: 11 coins buy 10 units, a tenth of a coin at least, 7 days to wait. */
export function testLiquidFake(): FakeLiquidStakingVenue {
  return createFakeLiquidStakingVenue({
    name: "Pool",
    commissionBps: bpsSchema.parse(1_000),
    minStakeBase: 10n ** 17n,
    minUnstakeBase: 10n ** 15n,
    unbondingSeconds: testUnbondingSeconds,
    rate: { coin: 11n, units: 10n },
    nowMs: testNowMs,
  });
}

/** The fake chain's registry with the fake pool's contract beside the fake router. */
export function liquidChains(): ReturnType<typeof createChainRegistry> {
  const definition = createFakeChainDefinition();
  const [router] = definition.contracts;
  const pool =
    router === undefined
      ? []
      : [{ ...router, venue: testLiquidVenue, name: "pool", address: "0x000000e1" }];
  return createChainRegistry({
    chains: [{ ...definition, contracts: [...definition.contracts, ...pool] }],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

/** An engine whose agent may stake on the fake pool, paper with five coins unless told. */
export async function startLiquidEngine(
  venue: FakeLiquidStakingVenue,
  options: TestEngineOptions = {},
): Promise<TestEngine> {
  const limits = { ...testLimits, venues: [...testLimits.venues, testLiquidVenue] };
  return startTestEngine({
    chains: liquidChains(),
    stakingVenues: [venue],
    paper: [{ ...halfCoin, base: 5n * 10n ** 18n }],
    ...options,
    agent: { limits, ...options.agent },
  });
}

/** A staking request of the test agent on the fake pool, which names no validator. */
export function liquidRequest(
  action: StakeRequest["action"],
  change: Partial<StakeRequest> = {},
): StakeRequest {
  return {
    kind: "stake",
    agent: testAgent,
    reason: "Earn on idle coin",
    action,
    venue: testLiquidVenue,
    ...(action === "stake" ? { amount: halfCoin } : {}),
    ...change,
  };
}
