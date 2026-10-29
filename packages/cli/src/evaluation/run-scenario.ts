import { type Clock, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  createMemoryImageReader,
  type EvaluationChat,
  type ModelChain,
  startEvaluationChat,
} from "@binference/runtime/testing";
import type { TranscriptEvent } from "@binference/store";
import type { SharedWorld } from "./load-scenarios.js";
import { scenarioContextOf } from "./scenario-context.js";
import { createScenarioEngine, type EngineCall, type ScenarioEngine } from "./scenario-engine.js";
import { scenarioWebOf } from "./scenario-web.js";
import type { Scenario, ScenarioStep } from "./scenario.schema.js";
import { visionChain } from "./stand-in-models.js";
import { objectOf, type WorldFacts } from "./world-answers.js";

/** One tool call of the agent in a run: what it asked and what it read back. */
export interface RunCall {
  readonly name: string;
  /** Its arguments as the model wrote them. */
  readonly text: string;
  /** Its arguments parsed, or none when they are not JSON. */
  readonly args?: JsonValue;
  readonly ran: boolean;
  readonly isError: boolean;
  readonly result: string;
  /** Its result is outside content. */
  readonly outside: boolean;
}

/** What one scenario's run did, for the scorer. */
export interface ScenarioRun {
  readonly scenario: Scenario;
  readonly calls: readonly RunCall[];
  /** The engine operations the tools called. */
  readonly engine: readonly EngineCall[];
  /** The agent's words to the owner, in order. */
  readonly replies: readonly string[];
  /** The owner's words, in order. */
  readonly owner: readonly string[];
  /** Outside content the turns read besides tool results, such as an image's description. */
  readonly outside: readonly string[];
  /** Why the run could not be scored: a turn that failed, or a model that did not answer. */
  readonly failure?: string;
}

/** What a run needs besides its scenario. */
export interface RunParts {
  readonly world: SharedWorld;
  /** The model under evaluation for this scenario. */
  readonly model: (scenario: Scenario) => ModelChain;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

// The scenarios' time: 1 January 2026, 10:00 UTC; and the agent's one wallet.
const runAt = 1_767_261_600_000;
const wallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
// A 1x1 PNG, the image every owner's image of a run stands for.
const tinyPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (char) => char.charCodeAt(0),
);

function factsOf(scenario: Scenario, world: SharedWorld): WorldFacts {
  return {
    tokens: [...world.tokens, ...(scenario.world.tokens ?? [])],
    balances: scenario.world.balances ?? world.balances,
    skills: world.skills,
    wallet,
    now: runAt,
  };
}

function fieldOf(content: JsonValue, name: string): JsonValue | undefined {
  return objectOf(content)[name];
}

function textOf(content: JsonValue, name = "text"): string {
  const value = fieldOf(content, name);
  return typeof value === "string" ? value : "";
}

function parsed(text: string): JsonValue | undefined {
  try {
    const read = jsonValueSchema.safeParse(JSON.parse(text));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}

function callsOf(events: readonly TranscriptEvent[]): readonly RunCall[] {
  const results = new Map(
    events
      .filter((event) => event.kind === "tool_result")
      .map((event) => [textOf(event.content, "callId"), event]),
  );
  return events
    .filter((event) => event.kind === "tool_call")
    .map((event) => runCallOf(event, results.get(textOf(event.content, "callId"))));
}

function runCallOf(call: TranscriptEvent, result: TranscriptEvent | undefined): RunCall {
  const text = textOf(call.content, "arguments");
  const args = parsed(text);
  return {
    name: textOf(call.content, "name"),
    text,
    ...(args === undefined ? {} : { args }),
    ran: result !== undefined && fieldOf(result.content, "ran") === true,
    isError: result !== undefined && fieldOf(result.content, "isError") === true,
    result: result === undefined ? "" : textOf(result.content),
    outside: result?.outside === true,
  };
}

function recordOf(
  scenario: Scenario,
  events: readonly TranscriptEvent[],
  engine: ScenarioEngine,
): Omit<ScenarioRun, "failure"> {
  const said = (role: string) =>
    events.filter((event) => event.role === role && event.kind === "text");
  return {
    scenario,
    calls: callsOf(events),
    engine: engine.calls(),
    replies: said("agent").map((event) => textOf(event.content)),
    owner: said("owner").map((event) => textOf(event.content)),
    outside: events
      .filter((event) => event.outside && event.kind !== "tool_result")
      .map((event) => textOf(event.content)),
  };
}

function imagesOf(steps: readonly ScenarioStep[]): readonly string[] {
  return steps.flatMap((step) => ("owner" in step ? (step.images ?? []) : []));
}

// The owner writes, or the last proposal settles; a settle with no proposal before it starts no
// turn, and the scorer finds the proposal missing.
async function playStep(
  step: ScenarioStep,
  run: { readonly chat: EvaluationChat; readonly engine: ScenarioEngine },
): Promise<number> {
  if ("owner" in step) {
    await run.chat.say(step.owner, step.images);
    return 1;
  }
  const intent = run.engine.settled(step.settle, step.reason);
  if (intent === undefined) {
    return 0;
  }
  await run.chat.settle(intent);
  return 1;
}

// A turn that did not end `ok`, or a step that started no turn, leaves the run unscored; the
// failure names the turns' status lines, such as `turn.failed.auth` for a refused key.
function failureOf(
  chat: Pick<EvaluationChat, "outcomes" | "statuses">,
  turns: number,
): string | undefined {
  const outcomes = chat.outcomes();
  const bad = outcomes.filter((outcome) => outcome !== "ok");
  const failed = chat.statuses().filter((status) => status.startsWith("turn.failed"));
  const why = failed.length === 0 ? "" : ` (${failed.join(", ")})`;
  if (bad.length > 0) {
    return `a turn ended ${bad.join(", ")}${why}`;
  }
  const missing = turns - outcomes.length;
  return missing > 0 ? `${String(missing)} step(s) started no turn` : undefined;
}

/**
 * Runs one scenario: the agent's own turns on the model given, with the scenario's engine, venue,
 * web, images and live facts, each step after the turns of the one before have ended. A model
 * that fails, times out or cannot be reached leaves the run with a failure, never a score.
 */
export async function runScenario(scenario: Scenario, parts: RunParts): Promise<ScenarioRun> {
  const { clock, signal } = parts;
  const facts = factsOf(scenario, parts.world);
  const engine = createScenarioEngine({ facts, world: scenario.world, agent });
  const images = imagesOf(scenario.steps);
  const chat = await startEvaluationChat({
    agent,
    locale: scenario.locale,
    models: parts.model(scenario),
    vision: visionChain(
      images.map((name) => scenario.world.images?.[name] ?? ""),
      clock,
    ),
    images: createMemoryImageReader(
      new Map(images.map((name) => [name, { contentType: "image/png", bytes: tinyPng }])),
    ),
    client: engine.client,
    context: scenarioContextOf(scenario.world, facts, agent),
    web: scenarioWebOf(scenario.world, clock),
    clock,
    signal,
  });
  let turns = 0;
  try {
    for (const step of scenario.steps) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each step waits for the turns of the one before
      turns += await playStep(step, { chat, engine });
    }
  } catch (error) {
    const events = await chat.events().catch(() => []);
    return { ...recordOf(scenario, events, engine), failure: `the run stopped: ${String(error)}` };
  }
  const record = recordOf(scenario, await chat.events(), engine);
  const failure = failureOf(chat, turns);
  return failure === undefined ? record : { ...record, failure };
}
