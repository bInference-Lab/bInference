import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import {
  type AgentLeases,
  type HeldLease,
  type LeaseRow,
  type WorkerId,
  workerIdSchema,
} from "../leases/agent-leases.js";
import { go, nthId, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh install's leases for one check, with the store's clock and rows beside them. */
export interface AgentLeasesSubject {
  readonly leases: AgentLeases;
  /** The install `create_install` made for this check, its own row free. */
  readonly installId: Id<"ins">;
  /** How far ahead the leases set each expiry: short, so a check can wait it out. */
  readonly leaseMs: number;
  /** Now on the store's own clock: the database's `clock_timestamp()` in epoch milliseconds. */
  now(): Promise<number>;
  /** Lets `ms` milliseconds pass on the store's clock. */
  passes(ms: number): Promise<void>;
  /** Every row of the install: its own first, then each agent's by id. */
  rows(): Promise<readonly LeaseRow[]>;
}

/** Makes a fresh install's leases for each check. */
export interface AgentLeasesHarness {
  create(): Promise<AgentLeasesSubject>;
}

const workerA = workerIdSchema.parse("worker-a");
const workerB = workerIdSchema.parse("worker-b");

async function takeAs(subject: AgentLeasesSubject, worker: WorkerId): Promise<HeldLease> {
  return okValue(
    await subject.leases.take({ installId: subject.installId, workerId: worker }, go()),
  );
}

// Long enough past a lease's expiry that every row of it has expired.
async function outlives(subject: AgentLeasesSubject): Promise<void> {
  await subject.passes(subject.leaseMs + 50);
}

// A lease worker A took, which expired, and the one worker B took after it.
async function takenOver(
  subject: AgentLeasesSubject,
): Promise<{ readonly lost: HeldLease; readonly held: HeldLease }> {
  const lost = await takeAs(subject, workerA);
  await outlives(subject);
  return { lost, held: await takeAs(subject, workerB) };
}

function check(
  name: string,
  harness: AgentLeasesHarness,
  run: (subject: AgentLeasesSubject) => Promise<void>,
): ContractCheck {
  return { name, run: async () => run(await harness.create()) };
}

function takeChecks(harness: AgentLeasesHarness): readonly ContractCheck[] {
  return [
    check("takes a fresh install one fence up, timed on the store's clock", harness, async (s) => {
      const before = await s.now();
      const lease = await takeAs(s, workerA);
      const after = await s.now();
      assert.deepEqual(
        { ...lease, takenAtMs: 0, expiresAtMs: 0 },
        {
          installId: s.installId,
          workerId: workerA,
          fence: 2,
          takenAtMs: 0,
          expiresAtMs: 0,
        },
      );
      assert.ok(lease.takenAtMs >= before && lease.takenAtMs <= after);
      assert.equal(lease.expiresAtMs, lease.takenAtMs + s.leaseMs);
      const times = { takenAtMs: lease.takenAtMs, expiresAtMs: lease.expiresAtMs };
      assert.deepEqual(await s.rows(), [
        { agentId: "", workerId: workerA, fence: 2, ...times, renewedAtMs: lease.takenAtMs },
      ]);
    }),
    check("refuses a take while another worker holds the install", harness, async (s) => {
      await takeAs(s, workerA);
      const rows = await s.rows();
      assert.deepEqual(await s.leases.take({ installId: s.installId, workerId: workerB }, go()), {
        ok: false,
        error: "held",
      });
      assert.deepEqual(await s.rows(), rows);
    }),
    check("gives the install to another worker once every row expired", harness, async (s) => {
      const { lost, held } = await takenOver(s);
      assert.equal(held.fence, lost.fence + 1);
      assert.deepEqual(await s.leases.renew(lost, go()), { ok: false, error: "lost" });
    }),
  ];
}

function stopChecks(harness: AgentLeasesHarness): readonly ContractCheck[] {
  return [
    check("frees the install at a clean stop, for another worker at once", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      await s.leases.stop(lease, go());
      assert.equal((await takeAs(s, workerB)).fence, lease.fence + 1);
    }),
    check("answers not_found for an install with no row", harness, async (s) => {
      const request = { installId: nthId("ins", 4_095), workerId: workerA };
      assert.deepEqual(await s.leases.take(request, go()), { ok: false, error: "not_found" });
    }),
    check("refuses a take on an aborted signal and takes nothing", harness, async (s) => {
      await rejectsAborted(async (options) =>
        s.leases.take({ installId: s.installId, workerId: workerA }, options),
      );
      assert.equal((await takeAs(s, workerB)).fence, 2);
    }),
  ];
}

function renewChecks(harness: AgentLeasesHarness): readonly ContractCheck[] {
  return [
    check("renews from the store's now, which keeps the install held", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      await s.passes(s.leaseMs * 0.6);
      const before = await s.now();
      const renewed = okValue(await s.leases.renew(lease, go()));
      const after = await s.now();
      assert.deepEqual({ ...renewed, expiresAtMs: 0 }, { ...lease, expiresAtMs: 0 });
      assert.ok(renewed.expiresAtMs >= before + s.leaseMs);
      assert.ok(renewed.expiresAtMs <= after + s.leaseMs);
      await s.passes(s.leaseMs * 0.6);
      const request = { installId: s.installId, workerId: workerB };
      assert.deepEqual(await s.leases.take(request, go()), { ok: false, error: "held" });
    }),
    check("renews its own expired lease while no other worker took it", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      await outlives(s);
      assert.equal(okValue(await s.leases.renew(lease, go())).fence, lease.fence);
    }),
    check("answers lost to a renewal once another worker took over", harness, async (s) => {
      const { lost } = await takenOver(s);
      const rows = await s.rows();
      assert.deepEqual(await s.leases.renew(lost, go()), { ok: false, error: "lost" });
      assert.deepEqual(await s.rows(), rows);
    }),
  ];
}

function addChecks(harness: AgentLeasesHarness): readonly ContractCheck[] {
  const agent = nthId("agt", 1);
  return [
    check("adds a new agent's row as a copy of the install's own", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      okValue(await s.leases.addAgent(lease, agent, go()));
      okValue(await s.leases.addAgent(lease, agent, go()));
      const [own, added, ...more] = await s.rows();
      assert.deepEqual(more, []);
      assert.deepEqual(added, { ...own, agentId: agent });
      await outlives(s);
      const next = await takeAs(s, workerB);
      assert.deepEqual(
        (await s.rows()).map((row) => [row.agentId, row.workerId, row.fence]),
        [
          ["", workerB, next.fence],
          [agent, workerB, next.fence],
        ],
      );
    }),
    check("adds no row for a lease that expired or that another took", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      await outlives(s);
      assert.deepEqual(await s.leases.addAgent(lease, agent, go()), { ok: false, error: "lost" });
      await takeAs(s, workerB);
      assert.deepEqual(await s.leases.addAgent(lease, agent, go()), { ok: false, error: "lost" });
      assert.deepEqual(
        (await s.rows()).map((row) => row.agentId),
        [""],
      );
    }),
  ];
}

function removeChecks(harness: AgentLeasesHarness): readonly ContractCheck[] {
  const agent = nthId("agt", 1);
  return [
    check("deletes a deleted agent's row and keeps the install's own", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      okValue(await s.leases.addAgent(lease, agent, go()));
      okValue(await s.leases.addAgent(lease, nthId("agt", 2), go()));
      okValue(await s.leases.removeAgent(lease, agent, go()));
      okValue(await s.leases.removeAgent(lease, agent, go()));
      assert.deepEqual(
        (await s.rows()).map((row) => row.agentId),
        ["", nthId("agt", 2)],
      );
    }),
    check("deletes no row for a lease another worker took", harness, async (s) => {
      const lease = await takeAs(s, workerA);
      okValue(await s.leases.addAgent(lease, agent, go()));
      await outlives(s);
      await takeAs(s, workerB);
      const removal = await s.leases.removeAgent(lease, agent, go());
      assert.deepEqual(removal, { ok: false, error: "lost" });
      assert.deepEqual(
        (await s.rows()).map((row) => row.agentId),
        ["", agent],
      );
    }),
  ];
}

/** The contract every `AgentLeases` adapter passes (spec 3, section 6.5, decision 0418). */
export function agentLeasesContract(harness: AgentLeasesHarness): readonly ContractCheck[] {
  return [
    ...takeChecks(harness),
    ...stopChecks(harness),
    ...renewChecks(harness),
    ...addChecks(harness),
    ...removeChecks(harness),
  ];
}
