import { describe, expect, it } from "vitest";
import { breakerWrite } from "../contracts/breaker-freeze-checks.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, testCall, type TestEngine } from "../operations/test-engine.js";
import { noticesOf } from "../orders/test-fills.js";
import { frozenNoticeKey } from "./freeze-agents.js";

const live = { signal: new AbortController().signal };
const pulledAtMs = testNowMs - 1_000;

// The breaker's pull or lift, written as its store write does (decision 0440).
async function moveBreaker(
  test: TestEngine,
  change: { readonly version: number; readonly isPulled: boolean },
): Promise<void> {
  const write = breakerWrite(change.version, { atMs: pulledAtMs, ...change });
  expect((await test.stores.intents.freeze(write, live)).ok).toBe(true);
}

async function agentNow(test: TestEngine) {
  const listed = await test.stores.agents.list(live);
  return listed.find(({ id }) => id === testAgent);
}

describe("the owner's freeze beside the breaker's hold", () => {
  it("marks the owner's freeze of an agent the breaker holds, and the lift leaves it", async () => {
    const test = await startTestEngine();
    await moveBreaker(test, { version: 1, isPulled: true });
    const frozen = await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
    expect(expectOk(frozen).frozenAt).toBe(testNowMs);
    expect(noticesOf(test)).toStrictEqual([
      { key: frozenNoticeKey, agent: testAgent, values: { agent: "main", surface: "cli" } },
    ]);
    const held = await agentNow(test);
    expect([held?.frozenAtMs, held?.ownFrozenAtMs]).toStrictEqual([pulledAtMs, testNowMs]);
    await moveBreaker(test, { version: 2, isPulled: false });
    const lifted = await agentNow(test);
    expect([lifted?.frozenAtMs, lifted?.breakerAtMs]).toStrictEqual([testNowMs, undefined]);
  });

  it("lists only the owner's own freezes in the safety status while the breaker holds", async () => {
    const test = await startTestEngine();
    await moveBreaker(test, { version: 1, isPulled: true });
    const before = expectOk(await test.engine.handlers["safety/status"](testCall({})));
    expect(before.agents).toStrictEqual([]);
    await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
    const after = expectOk(await test.engine.handlers["safety/status"](testCall({})));
    expect(after.agents).toStrictEqual([{ agent: testAgent, frozenAt: testNowMs }]);
  });
});
