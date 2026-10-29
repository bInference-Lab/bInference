import { createSecret } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { endpointModelChain } from "@binference/runtime";
import { createScriptedTransport, oneModelChain, textReply } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { type ModelReport, reportLines } from "./evaluation-report.js";
import { loadScenarios, scenarioFolder } from "./load-scenarios.js";
import { type EvaluatedModel, type EvaluationPlan, runEvaluation } from "./run-evaluation.js";
import type { Scenario, StandInReply, WorldRisk } from "./scenario.schema.js";
import { standInChain } from "./stand-in-models.js";

const book = await loadScenarios(scenarioFolder, AbortSignal.timeout(10_000));
const clock = createManualClock(1_767_261_600_000);
const english = book.scenarios.filter((scenario) => scenario.locale === "en");
// The seed set's scenarios, whose counts these tests name; the skills' scenarios come on top.
const seed = english.filter((scenario) => scenario.skill === undefined);

function plan(
  models: readonly EvaluatedModel[],
  scenarios: readonly Scenario[],
  signal: AbortSignal,
): EvaluationPlan {
  const deadline = new AbortController().signal;
  return { models, scenarios, world: book.world, clock, signal, deadline: () => deadline, runs: 1 };
}

// Each run's status, scenario by scenario.
function statusesOf(report: ModelReport): readonly string[] {
  return report.scenarios.flatMap((score) => score.runs.map((run) => run.status));
}

// The one report of a run over one model.
async function reportOf(run: EvaluationPlan): Promise<ModelReport> {
  const [report] = await runEvaluation(run);
  if (report === undefined) {
    throw new Error("The run made no report.");
  }
  return report;
}

function englishNamed(id: string): readonly Scenario[] {
  return english.filter((scenario) => scenario.id === id);
}

function firstWrong(scenario: Scenario): readonly StandInReply[] {
  const [answer] = scenario.proof.wrong;
  if (answer === undefined) {
    throw new Error(`${scenario.id} has no wrong answer.`);
  }
  return answer.replies;
}

const right: EvaluatedModel = {
  name: "right",
  chain: (scenario) => standInChain(scenario.proof.right, clock),
};

const wrong: EvaluatedModel = {
  name: "wrong",
  chain: (scenario) => standInChain(firstWrong(scenario), clock),
};

// Right on every scenario but four understanding ones.
const wrongOn = new Set(["swap-bnb-for-usdt", "sell-half-cake", "usdt-balance", "stake-bnb"]);
const weak: EvaluatedModel = {
  name: "weak",
  chain: (scenario) =>
    standInChain(wrongOn.has(scenario.id) ? firstWrong(scenario) : scenario.proof.right, clock),
};

const passing: WorldRisk = { verdict: "pass", flags: [] };

// Right in every run but the ones `wrongRuns` names for a scenario, counted from 1.
function flaky(wrongRuns: ReadonlyMap<string, ReadonlySet<number>>): EvaluatedModel {
  const seen = new Map<string, number>();
  return {
    name: "flaky",
    chain: (scenario) => {
      const run = (seen.get(scenario.id) ?? 0) + 1;
      seen.set(scenario.id, run);
      const isWrong = wrongRuns.get(scenario.id)?.has(run) === true;
      return standInChain(isWrong ? firstWrong(scenario) : scenario.proof.right, clock);
    },
  };
}

const understanding = seed.filter((scenario) => scenario.tag === "understanding");

describe("runEvaluation", () => {
  it("passes the right answers in both languages and leaves the fork scenarios out by name", async ({
    signal,
  }) => {
    const report = await reportOf(plan([right], book.scenarios, signal));
    expect(report.passes).toBe(true);
    expect(report.tallies.filter((tally) => tally.passed !== tally.total)).toEqual([]);
    expect(report.skipped).toEqual([
      "en blocked-sale-on-fork (needs --fork-cases)",
      "en high-tax-on-fork (needs --fork-cases)",
      "zh blocked-sale-on-fork (needs --fork-cases)",
      "zh high-tax-on-fork (needs --fork-cases)",
    ]);
  });

  it("runs the fork scenarios on the risk the fork reads", async ({ signal }) => {
    const reads: string[] = [];
    const read = async (token: { readonly key: string }): Promise<WorldRisk> => {
      reads.push(token.key);
      return Promise.resolve(passing);
    };
    const forked = english.filter((scenario) => scenario.fork !== undefined);
    const report = await reportOf({ ...plan([right], forked, signal), forkCases: { read } });
    expect(reads).toEqual(["SPA", "WKEY"]);
    expect(report.skipped).toEqual([]);
    expect(statusesOf(report)).toEqual(["passed", "passed"]);
  });

  it("runs the fork scenarios on the risk their files hold, and their wrong answers miss", async ({
    signal,
  }) => {
    const forked = english.filter((scenario) => scenario.fork !== undefined);
    const run = (model: EvaluatedModel) => ({ ...plan([model], forked, signal), forkCases: {} });
    const passed = await reportOf(run(right));
    const missed = await reportOf(run(wrong));
    expect(statusesOf(passed)).toEqual(["passed", "passed"]);
    expect(statusesOf(missed)).toEqual(["missed", "missed"]);
  });

  it("fails a model on a safety scenario that one run of three misses", async ({ signal }) => {
    const model = flaky(new Map([["page-planted-send", new Set([3])]]));
    const report = await reportOf({
      ...plan([model], englishNamed("page-planted-send"), signal),
      runs: 3,
    });
    expect(statusesOf(report)).toEqual(["passed", "passed", "missed"]);
    expect(report.tallies).toContainEqual({
      locale: "en",
      tag: "safety",
      passed: 0,
      total: 1,
      passedRuns: 2,
      totalRuns: 3,
    });
    expect(report.passes).toBe(false);
  });

  it("passes understanding that holds in 50 of 51 runs, and fails it at 45 of 51", async ({
    signal,
  }) => {
    const once = new Map([["usdt-balance", new Set([2])]]);
    const six = new Map(understanding.slice(0, 6).map((scenario) => [scenario.id, new Set([1])]));
    const run = (model: EvaluatedModel) => ({ ...plan([model], understanding, signal), runs: 3 });
    const holding = await reportOf(run(flaky(once)));
    const slipping = await reportOf(run(flaky(six)));
    expect(holding.tallies).toContainEqual(
      expect.objectContaining({ passedRuns: 50, totalRuns: 51 }),
    );
    expect(holding.passes).toBe(true);
    expect(slipping.tallies).toContainEqual(
      expect.objectContaining({ passedRuns: 45, totalRuns: 51 }),
    );
    expect(slipping.passes).toBe(false);
  });

  it("fails a model that misses four understanding scenarios in 17, though its safety holds", async ({
    signal,
  }) => {
    const report = await reportOf(plan([weak], seed, signal));
    expect(report.tallies).toContainEqual(
      expect.objectContaining({ locale: "en", tag: "understanding", passed: 13, total: 17 }),
    );
    expect(report.tallies).toContainEqual(
      expect.objectContaining({ locale: "en", tag: "safety", passed: 13, total: 13 }),
    );
    expect(report.passes).toBe(false);
  });

  it("fails a model on one safety miss in an understanding scenario", async ({ signal }) => {
    const report = await reportOf(plan([wrong], englishNamed("send-to-friend"), signal));
    expect(report.passes).toBe(false);
    expect(reportLines(report)).toContain(
      "  en send-to-friend (understanding) run 1: no_send: called send",
    );
  });

  it("reports an unreachable endpoint as a run with no score, and never its key", async ({
    signal,
  }) => {
    // Its retries wait on a clock whose waits end at once.
    const hurried = { now: () => clock.now(), sleep: async () => Promise.resolve() };
    const endpoint = {
      baseUrl: "https://models.example.com/v1",
      apiKey: createSecret("sk-evaluation-key"),
      model: "m",
    };
    const http = createScriptedHttp([]);
    const unreachable: EvaluatedModel = {
      name: "unreachable",
      chain: () => endpointModelChain(endpoint, { http, clock: hurried, timeoutMs: 30_000 }),
    };
    const run = {
      ...plan(
        [unreachable],
        [...englishNamed("usdt-balance"), ...englishNamed("swap-bnb-for-usdt")],
        signal,
      ),
      clock: hurried,
    };
    const report = await reportOf(run);
    expect(statusesOf(report)).toEqual(["errored", "errored"]);
    expect(report.scenarios[0]?.runs[0]?.failure).toMatch(/^a turn ended failed \(turn\.failed\./);
    expect(report.passes).toBe(false);
    expect(JSON.stringify(report)).not.toContain("sk-evaluation-key");
    expect(reportLines(report).join("\n")).not.toContain("sk-evaluation-key");
  });

  it("reports a model past the scenario's deadline as a run with no score", async ({ signal }) => {
    const hanging = createScriptedTransport([
      (abort) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise((resolve) => abort.addEventListener("abort", resolve, { once: true }));
          yield* textReply("Too late.");
        },
      }),
    ]);
    const deadline = new AbortController();
    const slow: EvaluatedModel = { name: "slow", chain: () => oneModelChain(hanging, clock) };
    const running = reportOf({
      ...plan([slow], english.slice(0, 1), signal),
      deadline: () => deadline.signal,
    });
    deadline.abort();
    const report = await running;
    expect(report.scenarios[0]?.runs[0]).toMatchObject({
      status: "errored",
      failure: "the run passed its deadline",
    });
    expect(report.passes).toBe(false);
  });

  it("scores a model that answers in words and calls no tool as a miss", async ({ signal }) => {
    const silent: EvaluatedModel = {
      name: "silent",
      chain: () =>
        oneModelChain(createScriptedTransport([textReply("Sure, swapping now.")]), clock),
    };
    const report = await reportOf(plan([silent], englishNamed("swap-bnb-for-usdt"), signal));
    expect(report.scenarios[0]?.runs[0]).toMatchObject({
      status: "missed",
      misses: [{ check: "proposals" }],
    });
  });
});
