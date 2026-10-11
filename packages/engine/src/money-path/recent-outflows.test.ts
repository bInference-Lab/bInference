import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import type { IntentState } from "../intents/intent-state.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { recentOutflowsOf } from "./recent-outflows.js";

const dayMs = 86_400_000;
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const intentId = (n: number): Id<"int"> =>
  idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);

interface Planted {
  readonly n: number;
  readonly atMs: number;
  readonly valueUsdMicros?: bigint;
  readonly isPaper?: boolean;
  /** Where the intent went after its confirmation. */
  readonly end?: IntentState;
}

async function stored(planted: readonly Planted[]) {
  const { intents } = createMemoryEngineStores();
  await inOrder(planted, async ({ n, atMs, valueUsdMicros, isPaper = false, end }) => {
    const draft = {
      id: intentId(n),
      agentId: testAgent,
      walletId: testWallet,
      kind: "swap",
      state: "confirmed",
      request: {},
      hasOutsideContent: false,
      isPaper,
      proposer: "engine",
      atMs,
      cause: {},
      ...(valueUsdMicros === undefined ? {} : { valueUsdMicros }),
    } as const;
    await intents.create(draft, live());
    const move = { id: intentId(n), expectedVersion: 0, atMs: atMs + 1, cause: {} };
    return end === undefined ? undefined : intents.transition({ ...move, state: end }, live());
  });
  return intents;
}

describe("the recent outflows", () => {
  it("counts each confirmation of the last 24 hours in the mode at its value, settled or not", async () => {
    const intents = await stored([
      { n: 1, atMs: testNowMs - dayMs, valueUsdMicros: 1n, end: "reconciled" },
      { n: 2, atMs: testNowMs - dayMs - 1, valueUsdMicros: 2n },
      { n: 3, atMs: testNowMs, valueUsdMicros: 3n },
      { n: 4, atMs: testNowMs, valueUsdMicros: 4n, isPaper: true, end: "paper_filled" },
      { n: 5, atMs: testNowMs, valueUsdMicros: 5n, end: "executing" },
    ]);
    const query = { agentId: testAgent, isPaper: false, nowMs: testNowMs };
    await expect(recentOutflowsOf(intents, query, live())).resolves.toStrictEqual([
      { atMs: testNowMs - dayMs, valueUsdMicros: 1n },
      { atMs: testNowMs, valueUsdMicros: 3n },
      { atMs: testNowMs, valueUsdMicros: 5n },
    ]);
    await expect(
      recentOutflowsOf(intents, { ...query, isPaper: true }, live()),
    ).resolves.toStrictEqual([{ atMs: testNowMs, valueUsdMicros: 4n }]);
  });

  it("leaves out the intent under check, one with no value and one that moved nothing", async () => {
    const intents = await stored([
      { n: 1, atMs: testNowMs, valueUsdMicros: 1n },
      { n: 2, atMs: testNowMs },
      { n: 3, atMs: testNowMs, valueUsdMicros: 3n, end: "cancelled" },
      { n: 4, atMs: testNowMs, valueUsdMicros: 4n, end: "expired" },
      { n: 5, atMs: testNowMs, valueUsdMicros: 5n, end: "failed_onchain" },
      { n: 6, atMs: testNowMs, valueUsdMicros: 6n },
    ]);
    const query = { agentId: testAgent, isPaper: false, nowMs: testNowMs, exclude: intentId(6) };
    await expect(recentOutflowsOf(intents, query, live())).resolves.toStrictEqual([
      { atMs: testNowMs, valueUsdMicros: 1n },
    ]);
  });

  it("refuses an aborted signal", async () => {
    const intents = await stored([]);
    const reason = new Error("stopped");
    const query = { agentId: testAgent, isPaper: false, nowMs: testNowMs };
    await expect(
      recentOutflowsOf(intents, query, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it("counts a failed intent again once a dropped step of it landed late", async () => {
    const intents = await stored([
      { n: 1, atMs: testNowMs, valueUsdMicros: 1n, end: "failed_onchain" },
      { n: 2, atMs: testNowMs, valueUsdMicros: 2n, end: "failed_onchain" },
    ]);
    const txId = idSchema("tx").parse("tx_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    await intents.recordLandedLate({ intentId: intentId(1), txId, atMs: testNowMs + 5 }, live());
    const query = { agentId: testAgent, isPaper: false, nowMs: testNowMs };
    await expect(recentOutflowsOf(intents, query, live())).resolves.toStrictEqual([
      { atMs: testNowMs, valueUsdMicros: 1n },
    ]);
  });
});
