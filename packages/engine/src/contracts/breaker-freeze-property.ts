import assert from "node:assert/strict";
import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import * as fc from "fast-check";
import type { AgentRecord } from "../agents/agent-record.js";
import { ownFreezeOf } from "../agents/breaker-hold.js";
import { createMemoryBreaker, type MemoryBreaker } from "../fakes/memory-breaker.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { testNowMs } from "../intents/test-intents.js";
import { unfreezeOrderMoves } from "../orders/freeze-order-moves.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore, InstallStore, IntentStore } from "../ports.js";
import { oneLookAtATime } from "../safety/breaker-looks.js";
import type { BreakerFollow, FollowBreakerOptions } from "../safety/follow-breaker.js";
import { freezeAgents } from "../safety/freeze-agents.js";
import { cardOf, confirmationOf, intentDraft, intentMove } from "./intent-fixtures.js";
import { orderDraft, orderMove, type PlantedPair } from "./order-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";

/** What the breaker's property runs on: one install's stores, and two of its agents. */
export interface BreakerFreezeSubject {
  readonly agents: AgentStore;
  readonly intents: IntentStore;
  readonly install: InstallStore;
  readonly orders: OrderStore;
  /** The agent whose order and rescue the property watches, and its wallet. */
  readonly first: PlantedPair;
  readonly second: Id<"agt">;
}

type Name = "first" | "second";
type Target = Name | "install";
type Step =
  | { readonly kind: "freeze" | "unfreeze"; readonly target: Target }
  | { readonly kind: "pull" | "lift" | "lag" | "fail" | "heal" | "restart" };

const target = fc.constantFrom<Target>("first", "second", "install");
const kinds = ["pull", "lift", "lag", "fail", "heal", "restart"] as const;
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constantFrom("freeze" as const, "unfreeze" as const), target }),
  fc.record({ kind: fc.constantFrom(...kinds) }),
);

interface Breaker {
  readonly pulled: boolean;
  readonly version: number;
}

/** What the owner's commands alone say, and what the breaker's source and the install hold. */
interface World {
  readonly own: Readonly<Record<Name, boolean>>;
  readonly source: Breaker;
  readonly applied: Breaker;
  readonly isFailing: boolean;
}

interface Bench {
  readonly subject: BreakerFreezeSubject;
  readonly breaker: MemoryBreaker;
  readonly options: FollowBreakerOptions;
  /** One look at the breaker, by the engine that runs now. */
  readonly look: () => Promise<BreakerFollow>;
  /** Starts the engine again over the same stores, which remembers nothing of its looks. */
  readonly restart: () => void;
}

const orderId = fixtureId("ord", 1);
const rescueId = fixtureId("int", 4);
const author = { by: "tok_owner", surface: "cli" };

const publish = (): void => undefined;
const stopTurns = async (): Promise<void> => Promise.resolve();

const namesOf = (to: Target): readonly Name[] => (to === "install" ? ["first", "second"] : [to]);

/**
 * Plants what the breaker's property watches: the first agent's order 1 active on its confirmed
 * card, and its rescue, intent 4, waiting for its tap.
 */
export async function plantWatched(
  subject: Pick<BreakerFreezeSubject, "intents" | "orders" | "first">,
): Promise<void> {
  const { intents, orders, first } = subject;
  const owner = { trigger: "propose" as const, proposer: "owner" as const, by: "x" };
  assert.ok((await intents.create({ ...intentDraft(first, 1), cause: owner }, live())).ok);
  const opened = { ...intentMove(1, 0, "awaiting_confirmation"), openCard: cardOf(1, 1) };
  assert.ok((await intents.transition(opened, live())).ok);
  const confirmed = { ...intentMove(1, 1, "confirmed"), confirmation: confirmationOf(1, 1) };
  assert.ok((await intents.transition(confirmed, live())).ok);
  const draft = { ...orderDraft(first, 1), expiresAtMs: testNowMs + 10 ** 9 };
  assert.ok((await orders.create(draft, live())).ok);
  const activation = [{ ...orderMove(1, 0, "active"), cardId: cardOf(1, 1).id }];
  assert.ok((await orders.move(activation, live())).ok);
  const rescue = { ...intentDraft(first, 4), id: rescueId, kind: "rescue" as const };
  const asked = { ...rescue, request: { kind: "rescue" }, isPaper: false, cause: owner };
  assert.ok((await intents.create(asked, live())).ok);
  const waits = { ...intentMove(4, 0, "awaiting_confirmation"), openCard: cardOf(4, 1) };
  assert.ok((await intents.transition(waits, live())).ok);
}

function benchOf(subject: BreakerFreezeSubject): Bench {
  const breaker = createMemoryBreaker();
  const clock = createManualClock(testNowMs);
  const ids = createIdSource({ clock, random: createSeededRandom(11) });
  const stored = createStoredIntents({ ...subject, ids, publish });
  const options = { ...subject, stored, clock, ids, publish, source: breaker, stopTurns };
  const engine = { look: oneLookAtATime(options) };
  return {
    subject,
    breaker,
    options,
    look: async () => engine.look(live().signal),
    restart: () => {
      engine.look = oneLookAtATime(options);
    },
  };
}

// The owner's unfreeze as its write lands, past `safety/unfreeze`: the marks, and the paused
// orders of the agents it frees while the breaker does not hold.
async function unfreeze(bench: Bench, to: Target): Promise<void> {
  const { agents, intents, install, orders } = bench.subject;
  const named = new Set(namesOf(to).map((name) => idOf(bench, name)));
  const all = await agents.list(live());
  const lifted = all.filter((agent) => named.has(agent.id) && ownFreezeOf(agent) !== undefined);
  const isBraked = (await install.read(live())).breakerAtMs !== undefined;
  const ids = isBraked ? [] : lifted.map((agent) => agent.id);
  const moves = await unfreezeOrderMoves(orders, ids, { nowMs: testNowMs, ...live() });
  const write = {
    atMs: testNowMs,
    isFrozen: false,
    agents: lifted.map((agent) => ({ agentId: agent.id, expectedVersion: agent.version })),
    isWholeInstall: to === "install",
    moves: [],
    orders: moves,
    ledger: [],
  };
  assert.ok((await intents.freeze(write, live())).ok);
}

function idOf(bench: Bench, name: Name): Id<"agt"> {
  return name === "first" ? bench.subject.first.agentId : bench.subject.second;
}

async function followed(world: World, bench: Bench): Promise<World> {
  await bench.look();
  const isApplied = !world.isFailing && world.source.version > world.applied.version;
  return isApplied ? { ...world, applied: world.source } : world;
}

function ownAfter(world: World, next: Step & { readonly target: Target }): World["own"] {
  const names = new Set(namesOf(next.target));
  const isFrozen = next.kind === "freeze";
  return {
    first: names.has("first") ? isFrozen : world.own.first,
    second: names.has("second") ? isFrozen : world.own.second,
  };
}

async function ownStep(world: World, bench: Bench, next: Step): Promise<World | undefined> {
  if (next.kind === "freeze") {
    const agent = next.target === "install" ? {} : { agent: idOf(bench, next.target) };
    await freezeAgents(bench.options, { ...agent, author }, live().signal);
    return { ...world, own: ownAfter(world, next) };
  }
  if (next.kind === "unfreeze") {
    await unfreeze(bench, next.target);
    return { ...world, own: ownAfter(world, next) };
  }
  if (next.kind === "fail" || next.kind === "heal") {
    bench.breaker.fail(next.kind === "fail" ? "breaker.unreadable" : undefined);
    return { ...world, isFailing: next.kind === "fail" };
  }
  return undefined;
}

async function run(world: World, bench: Bench, next: Step): Promise<World> {
  const owned = await ownStep(world, bench, next);
  if (owned !== undefined) {
    return owned;
  }
  if (next.kind === "restart") {
    bench.restart();
    return followed(world, bench);
  }
  const source =
    next.kind === "lag"
      ? { pulled: !world.applied.pulled, version: Math.max(0, world.applied.version - 1) }
      : { pulled: next.kind === "pull", version: world.source.version + 1 };
  bench.breaker.answer(source);
  return followed({ ...world, source }, bench);
}

// Each way an agent's freeze differs from the world: the owner's own, and whether it is held.
function agentMismatches(world: World, bench: Bench, agents: readonly AgentRecord[]) {
  return (["first", "second"] as const).flatMap((name) => {
    const agent = agents.find(({ id }) => id === idOf(bench, name));
    const isOwn = agent !== undefined && ownFreezeOf(agent) !== undefined;
    const isHeld = agent?.frozenAtMs !== undefined;
    const shouldHold = world.own[name] || world.applied.pulled;
    return [
      isOwn === world.own[name] ? "" : `${name}: own ${String(isOwn)}`,
      isHeld === shouldHold ? "" : `${name}: held ${String(isHeld)}`,
    ].filter((line) => line !== "");
  });
}

// Every way the stores differ from the world, as lines; none when they agree.
async function mismatches(world: World, bench: Bench): Promise<readonly string[]> {
  const { agents, install, orders, intents } = bench.subject;
  const facts = await install.read(live());
  const order = (await orders.get(orderId, live()))?.state;
  const isFirstHeld = world.own.first || world.applied.pulled;
  const isPaused = order === "paused";
  return [
    ...agentMismatches(world, bench, await agents.list(live())),
    ...((facts.breakerAtMs !== undefined) === world.applied.pulled ? [] : ["breaker mark"]),
    ...((facts.breakerVersion ?? 0) === world.applied.version ? [] : ["breaker version"]),
    ...(facts.breakerToldVersion === facts.breakerVersion ? [] : ["a version left untold"]),
    ...(isPaused === isFirstHeld
      ? []
      : [`order ${String(order)} while held ${String(isFirstHeld)}`]),
    ...((await intents.get(rescueId, live()))?.state === "awaiting_confirmation" ? [] : ["rescue"]),
  ];
}

async function runAll(create: () => Promise<BreakerFreezeSubject>, steps: readonly Step[]) {
  const subject = await create();
  await plantWatched(subject);
  const bench = benchOf(subject);
  let world: World = {
    own: { first: false, second: false },
    source: { pulled: false, version: 0 },
    applied: { pulled: false, version: 0 },
    isFailing: false,
  };
  const found: string[] = [];
  for (const next of steps) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step in turn
    world = await run(world, bench, next);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step in turn
    found.push(...(await mismatches(world, bench)));
  }
  return found;
}

/**
 * The property that the owner's freeze and the breaker's hold never end each other (decisions
 * 0440 and 0441), over any steps of the owner's freezes and unfreezes and of the breaker's source:
 * each agent is held exactly while one of them holds it, the first agent's order is paused exactly
 * while the agent is held, each version applied is told, and the rescue waits through it all.
 */
export async function breakerFreezeProperty(
  create: () => Promise<BreakerFreezeSubject>,
  numRuns: number,
): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.array(step, { maxLength: 12 }), async (steps: readonly Step[]) => {
      assert.deepEqual(await runAll(create, steps), []);
    }),
    { numRuns },
  );
}
