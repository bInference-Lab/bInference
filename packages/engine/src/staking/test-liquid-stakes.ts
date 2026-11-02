import {
  type AccountRef,
  type AssetRef,
  assetRefSchema,
  createChainRegistry,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLiquidStakingVenue,
  createFakeSigningScheme,
  type FakeLiquidStakingVenue,
} from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { createFormatter, reasonNamesOf, unsentReceiptText } from "@binference/i18n";
import type { IntentView, StakeRequest } from "@binference/protocol";
import { expectOk, testAgent, testLimits, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  testCall,
  testCallers,
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

const units = (base: bigint) => ({ asset: testPoolReceipt, base });

/** The fake pool as a refusal names it: its account and its name. */
export const testPool: { readonly account: AccountRef; readonly name: string } = {
  account: testLiquidFake().pool,
  name: "Pool",
};

/** The words of the view's refusal before it signed, in the language. */
export function liquidWordsOf(view: IntentView, locale: "en" | "zh"): string {
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  return unsentReceiptText(formatter, view.outcome?.reason ?? "", reasonNamesOf(view));
}

/**
 * Two refusals before any plan on a fresh fake pool: an unstake with nothing staked, then, after a
 * stake, an unstake of more units than it minted.
 */
export async function refusedBeforePlan(): Promise<readonly IntentView[]> {
  const test = await startLiquidEngine(testLiquidFake(), { agent: { approvalMode: "auto" } });
  const ask = async (request: StakeRequest, caller = testCallers.cli) =>
    expectOk(await test.engine.handlers["intent/propose"](testCall(request, caller)));
  const none = await ask(liquidRequest("unstake", { amount: units(10n ** 17n) }));
  await ask(liquidRequest("stake"), testCallers.runtime);
  const over = await ask(liquidRequest("unstake", { amount: units(10n ** 18n) }));
  return [none, over];
}
