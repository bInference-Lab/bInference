import { createIdSource, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { inboxMessageViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createHelperEndHandlers } from "./helper-ends.js";
import { createRunningTurns } from "./running-turns.js";

const helper = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const runtime = testCallers.runtime;

async function setUp() {
  const clock = createManualClock(Date.UTC(2026, 10, 8, 12));
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const handlers = createHelperEndHandlers({
    agents,
    agentInbox: createMemoryAgentInboxStore({ agents }),
    turns,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    clock,
    publish: (push) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
  });
  return { handlers, pushes };
}

const ended = ({ outsideContent }: { readonly outsideContent: boolean }) => ({
  agent: testAgent,
  helper,
  surface: "telegram" as const,
  text: '[binference: your helper "news" finished. Its report: quiet day.]',
  outsideContent,
});

// The inbox messages the engine pushed, as the runtime reads them.
function wokenOf(pushes: readonly EnginePush[]) {
  return pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data));
}

describe("a helper's end", () => {
  it("wakes the agent with the runtime's words, marked when the helper read outside content", async () => {
    const test = await setUp();
    expect(
      await test.handlers["helper/ended"](testCall(ended({ outsideContent: true }), runtime)),
    ).toStrictEqual({
      ok: true,
      value: {},
    });
    expect(
      await test.handlers["helper/ended"](testCall(ended({ outsideContent: false }), runtime)),
    ).toStrictEqual({
      ok: true,
      value: {},
    });
    const [marked, clean] = wokenOf(test.pushes);
    expect(marked).toMatchObject({
      kind: "inbox/message",
      agent: testAgent,
      surface: "telegram",
      text: ended({ outsideContent: true }).text,
      outsideContent: true,
    });
    expect(clean?.kind).toBe("inbox/message");
    expect(clean).not.toHaveProperty("outsideContent");
  });

  it("is refused to every caller but the current runtime, and for an agent it does not hold", async () => {
    const test = await setUp();
    const cli = await test.handlers["helper/ended"](
      testCall(ended({ outsideContent: false }), testCallers.cli),
    );
    expect(cli).toStrictEqual({ ok: false, error: "auth.scope" });
    const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const unknown = await test.handlers["helper/ended"](
      testCall({ ...ended({ outsideContent: false }), agent: other }, runtime),
    );
    expect(unknown).toStrictEqual({ ok: false, error: "agent.not_found" });
    expect(test.pushes).toStrictEqual([]);
  });
});
