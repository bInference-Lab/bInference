import type { AssetRef, ChainRef } from "@binference/chain";
import { type Bps, type Id, idSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LimitsValues } from "../agents/limits-record.js";
import type { SendLevelState } from "../agents/send-level-record.js";
import { isNoLooser, type LimitsState, limitsAt } from "../policy/limit-change.js";
import type { SendLevel } from "../policy/policy-rules.js";
import { sendLevelAt } from "../policy/send-level-change.js";
import {
  type AgentGuards,
  type CarriedRow,
  carryGuards,
  type CountedOutflow,
  guardsAfter,
  type InstallGuards,
} from "./restore-guards.js";

const nowMs = 1_800_000_000_000;
const dayMs = 86_400_000;
const chain = "fake:1" as ChainRef;
const tokens = ["fake:1/token:a", "fake:1/token:b", "fake:1/token:c"] as AssetRef[];
const idOf = (prefix: string, n: number): string =>
  `${prefix}_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`;
const agentIds = [1, 2, 3].map((n) => idSchema("agt").parse(idOf("agt", n)));
const intentIds = [1, 2, 3, 4, 5].map((n) => idSchema("int").parse(idOf("int", n)));

const bps = fc.integer({ min: 0, max: 2_000 }).map((value) => value as Bps);
const usd = fc.bigInt({ min: 0n, max: 10_000n });
const seconds = fc.integer({ min: 1, max: 900 });
const someOf = <T>(items: readonly T[]): fc.Arbitrary<readonly T[]> => fc.subarray([...items]);

const limitsValues: fc.Arbitrary<LimitsValues> = fc.record({
  perTradeUsdMicros: usd,
  rollingDayUsdMicros: usd,
  slippageRegistryBps: bps,
  slippageOtherBps: bps,
  priceImpactBps: bps,
  taxBps: bps,
  liquidityFloorUsdMicros: usd,
  minHealthFactorBp: fc.integer({ min: 10_000, max: 30_000 }),
  gasReserve: fc
    .option(fc.bigInt({ min: 0n, max: 100n }), { nil: undefined })
    .map((base) => (base === undefined ? [] : [{ chain, reserveBase: base }])),
  venues: someOf(["fake-swap", "other-swap", "third-swap"]),
  allowTokens: someOf(tokens),
  denyTokens: someOf(tokens),
  modelBudgetUsdMicros: usd,
  cardTradeExpiryS: seconds,
  cardOtherExpiryS: seconds,
  requoteAfterS: seconds,
  requoteToleranceBps: bps,
  orderExpiryDays: fc.integer({ min: 1, max: 60 }),
  copyPerBuyUsdMicros: usd,
  copyPerLeaderDayUsdMicros: usd,
});

// A time around now: some already past, some still to come.
const around = fc.integer({ min: nowMs - 2 * dayMs, max: nowMs + 2 * dayMs });
const maybeTime = fc.option(fc.integer({ min: nowMs - 3 * dayMs, max: nowMs }), {
  nil: undefined,
});

const limitsState: fc.Arbitrary<LimitsState> = fc
  .tuple(limitsValues, fc.option(fc.tuple(limitsValues, around), { nil: undefined }))
  .map(([values, pending]: readonly [LimitsValues, readonly [LimitsValues, number] | undefined]) =>
    pending === undefined
      ? { values }
      : { values, pending: { values: pending[0], atMs: pending[1] } },
  );

const level = fc.constantFrom<SendLevel>(0, 1, 2, 3);
const sendLevel: fc.Arbitrary<SendLevelState> = fc
  .tuple(level, fc.option(fc.tuple(level, around), { nil: undefined }))
  .map(([now, pending]: readonly [SendLevel, readonly [SendLevel, number] | undefined]) =>
    pending === undefined
      ? { level: now }
      : { level: now, pending: { level: pending[0], atMs: pending[1] } },
  );

interface DrawnAgent extends Omit<
  AgentGuards,
  "agentId" | "name" | "frozenAtMs" | "archivedAtMs" | "removedAddresses"
> {
  readonly frozenAtMs: number | undefined;
  readonly archivedAtMs: number | undefined;
  readonly removed: readonly string[];
}

function guardsOf(agentId: Id<"agt">, drawn: DrawnAgent): AgentGuards {
  const { frozenAtMs, archivedAtMs, removed, mode, approvalMode, limits } = drawn;
  return {
    agentId,
    name: agentId,
    mode,
    approvalMode,
    sendLevel: drawn.sendLevel,
    limits,
    ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
    ...(archivedAtMs === undefined ? {} : { archivedAtMs }),
    removedAddresses: removed.map((id) => ({ id, removedAtMs: nowMs - dayMs })),
  };
}

function agentOf(agentId: Id<"agt">): fc.Arbitrary<AgentGuards> {
  const drawn: fc.Arbitrary<DrawnAgent> = fc.record({
    mode: fc.constantFrom("paper", "live" as const),
    frozenAtMs: maybeTime,
    archivedAtMs: maybeTime,
    approvalMode: fc.constantFrom("manual", "auto" as const),
    sendLevel,
    limits: limitsState,
    removed: someOf(["adr_1", "adr_2", "adr_3"]),
  });
  return drawn.map((agent) => guardsOf(agentId, agent));
}

const outflows: fc.Arbitrary<readonly CountedOutflow[]> = fc.uniqueArray(
  fc.record({
    intentId: fc.constantFrom(...intentIds),
    agentId: fc.constantFrom(...agentIds),
    isPaper: fc.boolean(),
    atMs: fc.integer({ min: nowMs - dayMs, max: nowMs }),
    valueUsdMicros: fc.bigInt({ min: 0n, max: 5_000n }),
  }),
  { selector: (outflow) => outflow.intentId, maxLength: 5 },
);

const rows = fc.array(
  fc.record({ id: fc.string({ maxLength: 4 }), revoked_at: fc.option(fc.nat(), { nil: null }) }),
  { maxLength: 3 },
);

interface DrawnInstall {
  readonly agents: readonly AgentGuards[];
  readonly tokens: readonly CarriedRow[];
  readonly devices: readonly CarriedRow[];
  readonly owner: InstallGuards["telegramOwner"];
  readonly frozenAtMs: number | undefined;
  readonly rescueAddress: string | undefined;
  readonly outflows: readonly CountedOutflow[];
}

function installOf(drawn: DrawnInstall): InstallGuards {
  const { owner, frozenAtMs, rescueAddress } = drawn;
  return {
    access: {
      tokens: drawn.tokens,
      devices: drawn.devices,
      webPushSubscriptions: [],
      pairCodes: [],
      miniAppLaunches: [],
      miniAppTickets: [],
    },
    ...(owner === undefined ? {} : { telegramOwner: owner }),
    safety: {
      ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
      ...(rescueAddress === undefined ? {} : { rescueAddress }),
    },
    agents: drawn.agents,
    wallets: [],
    outflows: drawn.outflows,
    backups: [],
  };
}

const installGuards: fc.Arbitrary<InstallGuards> = fc
  .record({
    agents: someOf(agentIds).chain((ids) => fc.tuple(...ids.map(agentOf))),
    tokens: rows,
    devices: rows,
    owner: fc.option(fc.record({ userId: fc.integer({ min: 1, max: 9 }), pairedAtMs: fc.nat() }), {
      nil: undefined,
    }),
    frozenAtMs: maybeTime,
    rescueAddress: fc.option(fc.constantFrom("0xaa", "0xbb"), { nil: undefined }),
    outflows,
  })
  .map(installOf);

function spent(
  guards: InstallGuards,
  of: { readonly agentId: Id<"agt">; readonly isPaper: boolean },
): bigint {
  return guards.outflows
    .filter((outflow) => outflow.agentId === of.agentId && outflow.isPaper === of.isPaper)
    .reduce((sum, outflow) => sum + outflow.valueUsdMicros, 0n);
}

type Check = readonly [string, boolean];

function named(checks: readonly Check[]): string[] {
  return checks.filter(([, isLooser]) => isLooser).map(([what]) => what);
}

// Every way one agent of `after` could be looser than it is in `current` at `atMs`.
function agentLooser(
  current: InstallGuards,
  after: InstallGuards,
  pair: { readonly now: AgentGuards; readonly later: AgentGuards; readonly atMs: number },
): string[] {
  const { now, later, atMs } = pair;
  const id = now.agentId;
  const removed = new Set(later.removedAddresses.map((entry) => entry.id));
  const spending = [true, false].map((isPaper): Check => {
    const of = { agentId: id, isPaper };
    return [`${id} rolling day`, spent(after, of) < spent(current, of)];
  });
  return named([
    [`${id} mode`, now.mode === "paper" && later.mode !== "paper"],
    [`${id} freeze`, now.frozenAtMs !== undefined && later.frozenAtMs === undefined],
    [`${id} archive`, now.archivedAtMs !== undefined && later.archivedAtMs === undefined],
    [`${id} approval`, now.approvalMode === "manual" && later.approvalMode !== "manual"],
    [
      `${id} send level`,
      sendLevelAt(later.sendLevel, atMs).level < sendLevelAt(now.sendLevel, atMs).level,
    ],
    [
      `${id} limits`,
      !isNoLooser(limitsAt(now.limits, atMs).values, limitsAt(later.limits, atMs).values),
    ],
    [`${id} address book`, !now.removedAddresses.every((entry) => removed.has(entry.id))],
    ...spending,
  ]);
}

// Every way `after` could be looser than `current` at `atMs`, by name; none for a safe restore.
function looserThan(current: InstallGuards, after: InstallGuards, atMs: number): string[] {
  const isFrozen = current.safety.frozenAtMs !== undefined;
  return [
    ...named([
      ["access", after.access !== current.access],
      ["telegram owner", after.telegramOwner !== current.telegramOwner],
      ["freeze", isFrozen && after.safety.frozenAtMs === undefined],
      ["rescue", after.safety.rescueAddress !== current.safety.rescueAddress],
    ]),
    ...current.agents.flatMap((now) => {
      const later = after.agents.find((agent) => agent.agentId === now.agentId);
      return later === undefined ? [] : agentLooser(current, after, { now, later, atMs });
    }),
  ];
}

describe("the guards a restore carries", () => {
  it("never leave the restored state looser than the state it replaces, now or later", () => {
    fc.assert(
      fc.property(installGuards, installGuards, (current, restored) => {
        const after = guardsAfter(restored, carryGuards(current, restored, nowMs));
        for (const atMs of [nowMs, nowMs + dayMs, nowMs + 3 * dayMs]) {
          expect(looserThan(current, after, atMs)).toStrictEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });

  // The access rows, the owner and the rescue are the newer ones, and two limits neither of which
  // is stricter keep the replaced state's; every other guard of the backup holds too.
  it("keep what the backup holds stricter than the state it replaces", () => {
    const newer = /access|telegram|rescue|rolling|limits/u;
    fc.assert(
      fc.property(installGuards, installGuards, (current, restored) => {
        const after = guardsAfter(restored, carryGuards(current, restored, nowMs));
        const looser = looserThan(restored, after, nowMs).filter((what) => !newer.test(what));
        expect(looser).toStrictEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it("counts no outflow twice", () => {
    fc.assert(
      fc.property(installGuards, installGuards, (current, restored) => {
        const after = guardsAfter(restored, carryGuards(current, restored, nowMs));
        const ids = after.outflows.map((outflow) => outflow.intentId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 300 },
    );
  });
});
