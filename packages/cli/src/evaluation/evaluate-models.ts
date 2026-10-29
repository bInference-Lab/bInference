import process from "node:process";
import { parseArgs } from "node:util";
import { createSecret } from "@binference/core";
import { endpointModelChain } from "@binference/runtime";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { evaluationEnvSchema } from "./evaluation-env.schema.js";
import { createEvaluationHttp } from "./evaluation-http.js";
import { reportLines } from "./evaluation-report.js";
import { loadScenarios, scenarioFolder } from "./load-scenarios.js";
import { type EvaluatedModel, runEvaluation } from "./run-evaluation.js";
import type { Scenario, StandInReply } from "./scenario.schema.js";
import { standInChain } from "./stand-in-models.js";

// The model evaluation (ARCHITECTURE.md section 19; decision 0291), run by `pnpm eval:models`:
//
//   pnpm eval:models [--stand-in right|wrong] [--lang en|zh] [--only <id>] [--timeout-sec <n>]
//                    [--fork-cases] [--runs <n>]
//
// Each scenario runs --runs times on each model, 3 unless given: a safety scenario passes only
// when every run does, and an understanding scenario counts the share of its runs that pass.
//
// --fork-cases adds the scenarios whose token risk was read on a BNB Smart Chain fork, on the
// risk their files hold; `pnpm test:fork packages/cli/src/fork/evaluation-risk.test.ts` checks
// those reads against a fresh fork. Without it they are left out and named.
// --timeout-sec bounds each scenario's run, 300 seconds unless given; a run past it has no score.
//
// Without --stand-in it runs every scenario on each model of BINFERENCE_EVAL_MODELS at the
// OpenAI-compatible endpoint BINFERENCE_EVAL_BASE_URL, with BINFERENCE_EVAL_API_KEY: one on the
// internet, or on this machine's loopback (127.0.0.1, ::1, localhost), never another private address. The key goes
// only into the requests' header: nothing prints, logs or writes it. With --stand-in it runs the
// scenarios' own scripted answers instead, right or wrong, and reaches no network. Like
// `src/main.ts`, it alone reads `process`. It exits 0 when every model meets the bar, 1 when one
// misses it, and 2 when the run cannot start.

const options = {
  "stand-in": { type: "string" },
  lang: { type: "string" },
  only: { type: "string" },
  "timeout-sec": { type: "string", default: "300" },
  "fork-cases": { type: "boolean", default: false },
  runs: { type: "string", default: "3" },
} as const;

// A model call that starts no answer in 120 seconds ends (ARCHITECTURE.md section 16).
const modelIdleMs = 120_000;

function fail(message: string): never {
  process.stderr.write(`eval:models: ${message}\n`);
  process.exit(2);
}

function firstWrong(scenario: Scenario): readonly StandInReply[] {
  return scenario.proof.wrong[0]?.replies ?? [];
}

function standIns(which: string): readonly EvaluatedModel[] {
  const clock = createSystemClock();
  if (which === "right") {
    return [
      { name: "stand-in right", chain: (scenario) => standInChain(scenario.proof.right, clock) },
    ];
  }
  if (which === "wrong") {
    return [
      { name: "stand-in wrong", chain: (scenario) => standInChain(firstWrong(scenario), clock) },
    ];
  }
  return fail("--stand-in takes right or wrong.");
}

function endpointModels(): {
  readonly models: readonly EvaluatedModel[];
  readonly close: () => Promise<void>;
} {
  const env = evaluationEnvSchema.safeParse(process.env);
  const { BINFERENCE_EVAL_BASE_URL: baseUrl, BINFERENCE_EVAL_MODELS: names } = env.success
    ? env.data
    : {};
  if (baseUrl === undefined || names === undefined) {
    return fail("set BINFERENCE_EVAL_BASE_URL and BINFERENCE_EVAL_MODELS, or pass --stand-in.");
  }
  const key = env.data?.BINFERENCE_EVAL_API_KEY;
  const apiKey = key === undefined ? {} : { apiKey: createSecret(key) };
  const http = createSystemHttp({ version: "evaluation" });
  const clock = createSystemClock();
  const models = names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .map((model) => ({
      name: model,
      chain: () =>
        endpointModelChain(
          { baseUrl, model, ...apiKey },
          { http: createEvaluationHttp(http), clock, timeoutMs: modelIdleMs },
        ),
    }));
  return { models, close: async () => http.close() };
}

function chosen(scenarios: readonly Scenario[], lang?: string, only?: string): readonly Scenario[] {
  return scenarios.filter(
    (scenario) =>
      (lang === undefined || scenario.locale === lang) &&
      (only === undefined || scenario.id === only),
  );
}

const { values } = parseArgs({ args: process.argv.slice(2), options, strict: true });
const timeoutMs = Number(values["timeout-sec"]) * 1_000;
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  fail("--timeout-sec takes a whole number of seconds.");
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) {
  fail("--runs takes a whole number of runs, 1 or more.");
}
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
const book = await loadScenarios(scenarioFolder, stop.signal);
const scenarios = chosen(book.scenarios, values.lang, values.only);
if (scenarios.length === 0) {
  fail("no scenario matches --lang and --only.");
}
const standIn = values["stand-in"];
const target =
  standIn === undefined
    ? endpointModels()
    : { models: standIns(standIn), close: async () => Promise.resolve() };
const reports = await runEvaluation({
  models: target.models,
  scenarios,
  world: book.world,
  clock: createSystemClock(),
  signal: stop.signal,
  deadline: () => AbortSignal.timeout(timeoutMs),
  runs,
  ...(values["fork-cases"] ? { forkCases: {} } : {}),
});
await target.close();
for (const report of reports) {
  process.stdout.write(`${reportLines(report).join("\n")}\n`);
}
const meeting = reports.filter((report) => report.passes).length;
process.stdout.write(`${String(meeting)} of ${String(reports.length)} model(s) meet the bar.\n`);
process.exitCode = meeting === reports.length ? 0 : 1;
