import { BinferenceError, type Clock, idSchema } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import type { EngineHandler } from "@binference/engine";
import { createRunningTurns, turnLapseMs } from "@binference/engine/chat";
import { testAgentDraft } from "@binference/engine/testing";
import type { OperationName, PushFrame } from "@binference/protocol";
import { fixtureSettings, startInProcessRuntime } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeSupervisor } from "../agent-runtime/runtime-supervisor.js";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import {
  type Skeleton,
  type SkeletonOptions,
  skeletonCompositions,
  startSkeleton,
} from "../compose/test-skeleton.js";
import { endlessModel, type Model, researchModel } from "./runtime-load-model.js";
import {
  type Bell,
  createBell,
  createTimeline,
  drive,
  type LinkWatch,
  type Timeline,
  watchLink,
} from "./runtime-load-rig.js";

// The agent runtime's link to the engine under load (decision 0442): four agents, the turns an
// install runs at once, each hand work to four helpers at once, on a scripted model that streams
// at a fast model's pace, first with an engine that answers at once, then with reads that take 3
// seconds; and one turn whose model never finishes, on an engine slow to answer. The engine, the
// runtime and the model share one manual clock, which moves only while every call the runtime has
// in flight waits on it. Every turn must end through the runtime's own `turn/end`, before the
// engine would lapse it, every helper's report must wake its agent, and every model call must be
// charged once.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 60_000 };
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the runtime stops before the engine
    await stop();
  }
});

const agents = [1, 2, 3, 4].map((n) =>
  idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`),
);

// Each agent starts four helpers.
const helperCount = agents.length * 4;
// A run that has not ended by then never will.
const horizonMs = 15 * 60_000;

/** The engine, the runtime it started and what both share. */
interface Machine {
  readonly skeleton: Skeleton;
  readonly bell: Bell;
  readonly timeline: Timeline;
  readonly link: LinkWatch;
  readonly model: Model;
  readonly startMs: number;
}

/** What a run's engine and model are. */
interface Setup {
  readonly model: (timeline: Timeline) => Model;
  /** The engine's handlers the run slows down, over the machine once it started. */
  readonly handlers?: (machine: () => Machine) => SkeletonOptions["handlers"];
  readonly agents: number;
}

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

/** The engine's own handler of the operation, which a slow one of the test's calls. */
function engineHandler<N extends OperationName>(machine: Machine, op: N): EngineHandler<N> {
  const handlers: NonNullable<SkeletonOptions["handlers"]> =
    machine.skeleton.composed.engine.handlers;
  return handlers[op] ?? never();
}

// The clock of the machine once it started: the running turns take it before the engine exists.
function laterClock(machine: () => Machine): Clock {
  return {
    now: () => machine().skeleton.clock.now(),
    sleep: async (delayMs, signal) => machine().skeleton.clock.sleep(delayMs, signal),
  };
}

async function addAgents(skeleton: Skeleton, count: number): Promise<void> {
  for (const [index, agent] of agents.slice(1, count).entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- agents in order
    await skeleton.parts.stores.agents.create(
      testAgentDraft({ id: agent, name: `agent${String(index + 2)}` }),
      live(),
    );
  }
}

// The engine with its agents, and the runtime it starts on the shared clock and the model.
async function startMachine(setup: Setup): Promise<Machine> {
  const held: { machine?: Machine } = {};
  const machine = (): Machine => held.machine ?? never();
  const turns = createRunningTurns({ clock: laterClock(machine) });
  const [composition] = skeletonCompositions;
  const handlers = setup.handlers?.(machine);
  const skeleton = await startSkeleton(composition?.parts() ?? never(), {
    turns,
    ...(handlers === undefined ? {} : { handlers }),
  });
  stops.push(async () => skeleton.close());
  await addAgents(skeleton, setup.agents);
  const { clock } = skeleton;
  const bell = createBell();
  const timeline = createTimeline(clock, bell);
  const link = watchLink(clock, bell);
  const model = setup.model(timeline);
  held.machine = { skeleton, bell, timeline, link, model, startMs: clock.now() };
  const supervisor = createRuntimeSupervisor({
    start: async () =>
      Promise.resolve(
        startInProcessRuntime({
          replies: Array.from({ length: 200 }, () => model.reply),
          clock,
          signIn: async (start) => link.watch(await skeleton.connect(start.token, "runtime")),
        }),
      ),
    makeToken: async (signal) =>
      makeRuntimeToken(
        { access: skeleton.parts.stores.access, clock, random: createSeededRandom(31) },
        signal,
      ),
    startLine: {
      endpoint: "skeleton",
      paths: { agentDb: "agent.sqlite", workspace: "workspace" },
      settings: fixtureSettings,
    },
    turns,
    onRevoked: (tokens) =>
      tokens.forEach((token) => skeleton.composed.server.endSessions(token, "auth.revoked")),
    clock,
    logger: skeleton.logger,
  });
  supervisor.begin();
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  await link.listed;
  return machine();
}

/** One agent's chat topic, and whether every turn that started on it ended. */
interface Chat {
  readonly pushes: PushFrame[];
  readonly allEnded: () => boolean;
}

function watchChat(machine: Machine, agent: string): Chat {
  const pushes: PushFrame[] = [];
  machine.skeleton.client.subscribe(`chat:${agent}`, {
    onPush: (push) => {
      pushes.push(push);
      machine.bell.ring();
    },
    refetch: async () => Promise.resolve(),
  });
  const count = (kind: string): number => pushes.filter((push) => push.kind === kind).length;
  return { pushes, allEnded: () => count("chat/turnEnded") >= count("chat/turnStarted") };
}

// Moves the machine's clock until the run is over, or past the horizon when it never will be.
async function driveUntil(machine: Machine, isDone: () => boolean): Promise<void> {
  const { skeleton, bell, timeline, link } = machine;
  const { clock } = skeleton;
  await drive({
    clock,
    bell,
    timeline,
    link,
    crossSockets: async () => {
      await skeleton.client.call("engine/status", {}, live());
    },
    isOver: () => isDone() || clock.now() > machine.startMs + horizonMs,
  });
}

const lapses = (machine: Machine) =>
  machine.skeleton.logger.records().filter((record) => record.event === "chat.turn_lapsed");

// Each agent asks for research, and the run goes on until every agent read its helpers' reports
// and every turn ended, or the horizon passes.
async function research(machine: Machine): Promise<readonly Chat[]> {
  const chats = agents.map((agent) => watchChat(machine, agent));
  await Promise.all(
    agents.map(async (agent, index) =>
      machine.skeleton.client.call(
        "chat/post",
        { agent, text: `Research four tokens for agent ${String(index + 1)}` },
        live(),
      ),
    ),
  );
  const isDone = () =>
    machine.model.heard.size >= helperCount && chats.every((chat) => chat.allEnded());
  await driveUntil(machine, isDone);
  return chats;
}

// The calls that start, close or report a turn, which find room on the link however many reads
// wait: a refusal of one, by the engine or the runtime's own client, as `<op> <code>`.
const turnsOwn: ReadonlySet<string> = new Set([
  "turn/start",
  "turn/status",
  "usage/record",
  "turn/end",
  "inbox/take",
  "helper/ended",
]);
const isTheTurnsOwn = (refusal: string): boolean => turnsOwn.has(refusal.split(" ")[0] ?? "");

// The engine's handler of the operation, slowed: it answers `delayMs` after the call came.
function after<N extends OperationName>(
  machine: () => Machine,
  op: N,
  delayMs: number,
): EngineHandler<N> {
  return async (call) => {
    await machine().timeline.wait(delayMs, call.signal, op);
    return engineHandler(machine(), op)(call);
  };
}

// A read the engine takes 3 seconds to answer, as a quote over venues or a risk check can.
const readMs = 3_000;

function slowReads(machine: () => Machine): SkeletonOptions["handlers"] {
  return {
    "portfolio/get": after(machine, "portfolio/get", readMs),
    "asset/get": after(machine, "asset/get", readMs),
    "quote/get": after(machine, "quote/get", readMs),
  };
}

// When the engine's `turn/start` held each turn, on the shared clock.
const startedAtMs: number[] = [];

// A slow engine: `turn/start` answers 20 seconds after it held the turn, a status line and an end
// take 9 seconds each, and a usage record never gets its answer.
function slowEnds(machine: () => Machine): SkeletonOptions["handlers"] {
  return {
    "turn/start": async (call) => {
      const started = await engineHandler(machine(), "turn/start")(call);
      startedAtMs.push(machine().skeleton.clock.now());
      await machine().timeline.wait(20_000, call.signal, "turn/start");
      return started;
    },
    "turn/status": after(machine, "turn/status", 9_000),
    "turn/end": after(machine, "turn/end", 9_000),
    "usage/record": async (call) => {
      await machine().timeline.hold("usage/record", call.signal);
      return engineHandler(machine(), "usage/record")(call);
    },
  };
}

// A usage record the engine takes 15 seconds to store, past an end write's 10.
function slowUsage(machine: () => Machine): SkeletonOptions["handlers"] {
  return { "usage/record": after(machine, "usage/record", 15_000) };
}

// The owner asks one agent something its model never finishes, and the run goes on a minute past
// the engine's lapse: how long after the engine held the turn each `turn/end` was answered.
async function runEndless(machine: Machine): Promise<readonly number[]> {
  startedAtMs.length = 0;
  const [agent = never()] = agents;
  await machine.skeleton.client.call("chat/post", { agent, text: "Go on" }, live());
  const { clock } = machine.skeleton;
  const startMs = (): number => startedAtMs[0] ?? clock.now();
  const isDone = () =>
    machine.link.endsAtMs.length > 0 && clock.now() > startMs() + turnLapseMs + 60_000;
  await driveUntil(machine, isDone);
  return machine.link.endsAtMs.map((endMs) => endMs - startMs());
}

// The owner asks one agent, and the run goes on until its turn ended: the data of each end.
async function askOnce(machine: Machine): Promise<readonly PushFrame["data"][]> {
  const [agent = never()] = agents;
  const chat = watchChat(machine, agent);
  await machine.skeleton.client.call("chat/post", { agent, text: "Go on" }, live());
  const endsOf = () =>
    chat.pushes.filter((push) => push.kind === "chat/turnEnded").map((push) => push.data);
  await driveUntil(machine, () => endsOf().length > 0);
  return endsOf();
}

describe("the agent runtime's link to the engine", () => {
  it("ends every turn and wakes every agent with each helper's report", slow, async () => {
    const machine = await startMachine({ model: researchModel(3), agents: agents.length });
    const chats = await research(machine);
    expect(machine.link.refused).toStrictEqual([]);
    expect(chats.map((chat) => chat.allEnded())).toStrictEqual(agents.map(() => true));
    expect(machine.link.reports).toHaveLength(helperCount);
    expect(machine.model.heard.size).toBe(helperCount);
    expect(machine.link.charged.size).toBe(machine.model.calls());
    expect(lapses(machine)).toStrictEqual([]);
  });

  it(
    "charges every model call once and hears every report while reads take 3 seconds",
    slow,
    async () => {
      const machine = await startMachine({
        model: researchModel(5),
        handlers: slowReads,
        agents: agents.length,
      });
      const chats = await research(machine);
      expect(machine.link.refused.filter(isTheTurnsOwn)).toStrictEqual([]);
      expect(chats.map((chat) => chat.allEnded())).toStrictEqual(agents.map(() => true));
      expect(machine.link.reports).toHaveLength(helperCount);
      expect(machine.model.heard.size).toBe(helperCount);
      expect(machine.link.charged.size).toBe(machine.model.calls());
      expect(lapses(machine)).toStrictEqual([]);
    },
  );

  it("ends a turn its model never finishes before the engine lapses it", slow, async () => {
    const machine = await startMachine({ model: endlessModel, handlers: slowEnds, agents: 1 });
    const endsAfterStartMs = await runEndless(machine);
    expect(endsAfterStartMs.map((afterMs) => afterMs < turnLapseMs)).toStrictEqual([true]);
    expect(lapses(machine)).toStrictEqual([]);
  });

  it("waits as long as the engine takes to charge a model call no halt cut", slow, async () => {
    const machine = await startMachine({ model: researchModel(3), handlers: slowUsage, agents: 1 });
    expect(await askOnce(machine)).toMatchObject([{ outcome: "ok" }]);
    expect([machine.link.charged.size, machine.model.calls()]).toStrictEqual([1, 1]);
  });
});
