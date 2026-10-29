import type { Clock } from "@binference/core";
import type { ModelChain } from "@binference/runtime/testing";
import { type ModelReport, reportOf } from "./evaluation-report.js";
import type { SharedWorld } from "./load-scenarios.js";
import { runScenario, type ScenarioRun } from "./run-scenario.js";
import type { Scenario, WorldRisk, WorldToken } from "./scenario.schema.js";
import { scoreScenario, type ScenarioVerdict } from "./score-scenario.js";

/** A model the evaluation runs every scenario on: its name, and its chain for each scenario. */
export interface EvaluatedModel {
  readonly name: string;
  readonly chain: (scenario: Scenario) => ModelChain;
}

/** Reads a token's risk on a BNB Smart Chain fork, for the scenarios that ask for one. */
type ForkRisk = (token: WorldToken, signal: AbortSignal) => Promise<WorldRisk>;

/**
 * How the scenarios whose token risk comes from a fork run: on the risk their files hold, which
 * the fork suite checks against a fork, or on the risk `read` gives now.
 */
interface ForkCases {
  readonly read?: ForkRisk;
}

/** What one evaluation runs: the models, the scenarios and their world, and its bounds. */
export interface EvaluationPlan {
  readonly models: readonly EvaluatedModel[];
  readonly scenarios: readonly Scenario[];
  readonly world: SharedWorld;
  /** Runs the scenarios that need a fork; without it, they are left out and named. */
  readonly forkCases?: ForkCases;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  /** A new deadline for each scenario's run; a run past it has no score. */
  readonly deadline: () => AbortSignal;
}

async function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const stop = (): void => reject(new Error("the run passed its deadline"));
    if (signal.aborted) {
      stop();
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

function withRisk(token: WorldToken, risk: WorldRisk): WorldToken {
  return { ...token, risk };
}

// The scenario with its fork token's risk read on the fork in place of its recorded one.
async function withForkRisk(scenario: Scenario, plan: EvaluationPlan): Promise<Scenario> {
  const key = scenario.fork?.token;
  const tokens = scenario.world.tokens ?? [];
  const read = plan.forkCases?.read;
  if (key === undefined || read === undefined) {
    return scenario;
  }
  const fresh = await Promise.all(
    tokens.map(async (token) =>
      token.key === key ? withRisk(token, await read(token, plan.signal)) : token,
    ),
  );
  return { ...scenario, world: { ...scenario.world, tokens: fresh } };
}

async function runOne(
  scenario: Scenario,
  model: EvaluatedModel,
  plan: EvaluationPlan,
): Promise<ScenarioRun> {
  const deadline = plan.deadline();
  const signal = AbortSignal.any([plan.signal, deadline]);
  const parts = { world: plan.world, model: model.chain, clock: plan.clock, signal };
  try {
    return await Promise.race([
      runScenario(await withForkRisk(scenario, plan), parts),
      untilAbort(signal),
    ]);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    return { scenario, calls: [], engine: [], replies: [], owner: [], outside: [], failure };
  }
}

/** The addresses of the shared world's tokens, which a reply may name without reading them. */
function knownAddresses(world: SharedWorld): ReadonlySet<string> {
  const found = world.tokens.flatMap((token) => token.asset.match(/0x[0-9a-f]{40}/gi) ?? []);
  return new Set(found.map((address) => address.toLowerCase()));
}

/**
 * Runs every scenario on every model, one run at a time, and scores each. A scenario that needs a
 * fork is left out, and named, when the plan has no fork.
 */
export async function runEvaluation(plan: EvaluationPlan): Promise<readonly ModelReport[]> {
  const needsFork = (scenario: Scenario): boolean =>
    scenario.fork !== undefined && plan.forkCases === undefined;
  const runnable = plan.scenarios.filter((scenario) => !needsFork(scenario));
  const skipped = plan.scenarios
    .filter(needsFork)
    .map((scenario) => `${scenario.locale} ${scenario.id} (needs --fork-cases)`);
  const known = knownAddresses(plan.world);
  const reports: ModelReport[] = [];
  for (const model of plan.models) {
    const verdicts: ScenarioVerdict[] = [];
    for (const scenario of runnable) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one run at a time, so a provider's rate limit and the machine's load stay low
      verdicts.push(scoreScenario(await runOne(scenario, model, plan), known));
    }
    reports.push(reportOf(model.name, verdicts, skipped));
  }
  return reports;
}
