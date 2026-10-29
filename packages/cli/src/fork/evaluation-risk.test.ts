import { withFork } from "@binference/chain-evm/fork";
import { createManualClock } from "@binference/core/testing";
import type { RiskAssessment } from "@binference/engine/risk";
import { describe, expect, it } from "vitest";
import { loadScenarios, scenarioFolder } from "../evaluation/load-scenarios.js";
import { type EvaluatedModel, runEvaluation } from "../evaluation/run-evaluation.js";
import type { Scenario, WorldRisk, WorldToken } from "../evaluation/scenario.schema.js";
import { standInChain } from "../evaluation/stand-in-models.js";
import { benchOf, cleanSources, honeypot, type RiskBench, subjectOf, taxed } from "./risk-bench.js";

// The model evaluation's risk scenarios on the fork: the engine's own risk check reads each of
// their tokens on today's chain, the scenario files hold what it reads, and their right and wrong
// answers score the same on the fresh read as on the recorded one.

const book = await loadScenarios(scenarioFolder, AbortSignal.timeout(10_000));
const forked = book.scenarios.filter((scenario) => scenario.fork !== undefined);
const clock = createManualClock(1_767_261_600_000);
const addresses: ReadonlyMap<string, `0x${string}`> = new Map([
  ["SPA", honeypot],
  ["WKEY", taxed],
]);

function worldRiskOf({ view, refusal }: RiskAssessment): WorldRisk {
  return {
    verdict: view.verdict,
    ...(refusal === undefined ? {} : { refusal }),
    flags: view.flags.map((flag) => ({ code: flag.code, source: flag.source })),
    ...(view.buyTaxBps === undefined ? {} : { buyTaxBps: view.buyTaxBps }),
    ...(view.sellTaxBps === undefined ? {} : { sellTaxBps: view.sellTaxBps }),
  };
}

async function readOn(
  bench: RiskBench,
  token: WorldToken,
  signal: AbortSignal,
): Promise<WorldRisk> {
  const address = addresses.get(token.key);
  if (address === undefined) {
    throw new Error(`No fork token for ${token.key}.`);
  }
  const assessment = await bench.check.assess(await subjectOf(bench, address), { signal });
  return worldRiskOf(assessment);
}

// The token whose risk a scenario reads on the fork, with the risk its file holds.
function forkTokenOf(scenario: Scenario): WorldToken & { readonly risk: WorldRisk } {
  const token = scenario.world.tokens?.find((item) => item.key === scenario.fork?.token);
  if (token?.risk === undefined) {
    throw new Error(`${scenario.id} names no fork token with a recorded risk.`);
  }
  return { ...token, risk: token.risk };
}

// What the comparison reads of a risk: its verdict, its flags and the engine's refusal.
function shown(risk: WorldRisk): readonly unknown[] {
  return [risk.verdict, risk.flags, risk.refusal];
}

const right: EvaluatedModel = {
  name: "right",
  chain: (scenario) => standInChain(scenario.proof.right, clock),
};

describe("the model evaluation's risk scenarios on a BSC fork", () => {
  it("hold the verdict, the flags and the refusal the engine's risk check reads today", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [honeypot, taxed]));
      const reads: { readonly recorded: WorldRisk; readonly live: WorldRisk }[] = [];
      for (const scenario of forked) {
        const token = forkTokenOf(scenario);
        // oxlint-disable-next-line eslint/no-await-in-loop -- one read at a time on the shared fork
        reads.push({ recorded: token.risk, live: await readOn(bench, token, signal) });
      }
      expect(reads.map(({ live }) => shown(live))).toEqual(
        reads.map(({ recorded }) => shown(recorded)),
      );
    }));

  it("pass their right answers on the fork's reads, in both languages", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [honeypot, taxed]));
      const read = async (token: WorldToken, aborted: AbortSignal) => readOn(bench, token, aborted);
      const plan = {
        models: [right],
        scenarios: forked,
        world: book.world,
        clock,
        signal,
        deadline: () => new AbortController().signal,
        forkCases: { read },
        runs: 1,
      };
      const [report] = await runEvaluation(plan);
      expect(report?.scenarios.flatMap((score) => score.runs.map((run) => run.status))).toEqual(
        forked.map(() => "passed"),
      );
    }));
});
