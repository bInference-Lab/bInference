import { err, type Id, idSchema, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ConfigAuthor } from "../audit/journal-config-change.js";
import { createMemoryBreaker } from "../fakes/memory-breaker.js";
import { createMemoryQuotaSource } from "../fakes/memory-quota-source.js";
import type { IntentState } from "../intents/intent-state.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  listedArchived,
  startTestEngine,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
} from "../operations/test-engine.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type {
  ConfigChangeRefusal,
  ConfigChanges,
  ConfigPatchAsked,
} from "./config-change-parts.js";
import type { ConfigChangeQuote, ConfigKeyChange, ConfigPatch } from "./config-change-quote.js";

const live = { signal: new AbortController().signal };
const patch = { logging: { level: "debug" } };
const change = { path: "logging.level", before: '"info"', after: '"debug"' };
const walletless = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000b1");
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000b2";

/** A config file that answers one change, and keeps each apply it is asked for. */
interface FakeConfig extends ConfigChanges {
  /** What each preview was asked besides the patch: the hash and the lists it may shorten. */
  readonly previewed: Omit<ConfigPatchAsked, "patch">[];
  readonly applied: {
    readonly patch: ConfigPatch;
    readonly quote: ConfigChangeQuote;
    readonly author: ConfigAuthor;
    readonly reason?: string;
  }[];
}

function fakeConfig(answers: {
  readonly refusal?: ConfigChangeRefusal;
  readonly previewRefusal?: "config.invalid" | "config.secret_inline";
  readonly restartNeeded?: boolean;
  /** The first apply rejects, as a stop between the tap and the write leaves it. */
  readonly isFirstStopped?: boolean;
  /** The keys a preview names; one when absent. */
  readonly changes?: readonly ConfigKeyChange[];
}): FakeConfig {
  const applied: FakeConfig["applied"] = [];
  const previewed: FakeConfig["previewed"] = [];
  let stops = answers.isFirstStopped === true ? 1 : 0;
  return {
    applied,
    previewed,
    view: async (path) =>
      Promise.resolve(
        path === "nowhere"
          ? err("protocol.bad_args")
          : ok({
              value: "info",
              rules: [{ path: "logging.level", description: "", takes: "text" }],
              hash: "0".repeat(64),
            }),
      ),
    preview: async ({ patch: _patch, ...asked }) => {
      previewed.push(asked);
      return Promise.resolve(
        answers.previewRefusal === undefined
          ? ok({
              changes: answers.changes ?? [change],
              restartNeeded: answers.restartNeeded === true,
            })
          : err(answers.previewRefusal),
      );
    },
    apply: async (made, { author }) => {
      if (stops > 0) {
        stops -= 1;
        return Promise.reject(new Error("The engine stopped."));
      }
      applied.push({ ...made, author });
      return Promise.resolve(answers.refusal === undefined ? ok(undefined) : err(answers.refusal));
    },
  };
}

// The engine's `config/propose`, which a test engine with a config file serves.
function proposeOf(test: TestEngine) {
  const handler = test.engine.handlers["config/propose"];
  if (handler === undefined) {
    throw new Error("Expected config/propose to be served.");
  }
  return handler;
}

async function propose(test: TestEngine, caller: EngineCaller = testCallers.cli) {
  const args = { patch, reason: "The owner wants more detail in the logs." };
  return test.engine.handlers["config/propose"]?.(testCall(args, caller));
}

async function proposed(test: TestEngine, caller?: EngineCaller): Promise<Id<"int">> {
  const answered = await propose(test, caller);
  if (answered === undefined) {
    throw new Error("Expected config/propose to be served.");
  }
  return expectOk(answered).intent;
}

async function tap(test: TestEngine, intent: Id<"int">) {
  const answeredBy = { surface: "telegram", by: "telegram" } as const;
  return test.engine.answer({ intent, decision: "confirm", cardVersion: 1, answeredBy }, live);
}

async function stateOf(test: TestEngine, intent: Id<"int">): Promise<IntentState | undefined> {
  return (await test.stores.intents.get(intent, live))?.state;
}

async function cardOf(test: TestEngine, intent: Id<"int">) {
  const [card] = await test.stores.intents.cards(intent, live);
  if (card === undefined) {
    throw new Error(`Expected intent ${intent} to have a card.`);
  }
  const showings = createCardShowings({
    ...test.stores,
    chains: testChains(),
    venues: { hasNoDeadline: () => false },
  });
  return (await showings.opened({ intent, card: card.id }, live))?.card;
}

describe("a config change from a chat", () => {
  it("refuses a change past the agent's proposals of the minute, storing nothing", async () => {
    const quotas = createMemoryQuotaSource({ proposalsPerMinute: 0 });
    const config = fakeConfig({});
    const test = await startTestEngine({ configChanges: config, quotas });
    await expect(propose(test)).rejects.toMatchObject({ code: "quota.proposals" });
    expect(config.previewed).toStrictEqual([]);
    expect(
      await test.stores.intents.createdSince({ agentId: testAgent, fromMs: 0 }, live),
    ).toStrictEqual([]);
  });

  it("opens a card naming each key before and after, and the reason, and changes nothing yet", async () => {
    const config = fakeConfig({ restartNeeded: true });
    const test = await startTestEngine({ configChanges: config });
    const intent = await proposed(test);
    expect(await stateOf(test, intent)).toBe("awaiting_confirmation");
    const card = await cardOf(test, intent);
    expect(card?.lines.find(({ key }) => key === "card.configChange.action")?.values).toStrictEqual(
      {
        count: { type: "count", count: 1 },
        changes: { type: "text", text: 'logging.level: "info" → "debug"' },
        restart: { type: "choice", choice: "yes" },
      },
    );
    expect(config.applied).toStrictEqual([]);
  });

  it("applies the change on the owner's tap, as the surface that tapped, and ends reconciled", async () => {
    const config = fakeConfig({});
    const test = await startTestEngine({ configChanges: config });
    const intent = await proposed(test);
    expectOk(await tap(test, intent));
    expect(config.applied).toMatchObject([
      {
        patch,
        reason: "The owner wants more detail in the logs.",
        author: { surface: "telegram" },
      },
    ]);
    expect(await stateOf(test, intent)).toBe("reconciled");
  });

  it("takes the tap while the engine is locked, since a config change signs nothing", async () => {
    const config = fakeConfig({});
    const test = await startTestEngine({ configChanges: config, isLocked: () => true });
    const intent = await proposed(test);
    expectOk(await tap(test, intent));
    expect(await stateOf(test, intent)).toBe("reconciled");
  });

  it("ends failed_check with config_moved when a key moved after the card opened", async () => {
    const test = await startTestEngine({ configChanges: fakeConfig({ refusal: "config_moved" }) });
    const intent = await proposed(test);
    expectOk(await tap(test, intent));
    const stored = await test.stores.intents.get(intent, live);
    expect([stored?.state, stored?.reason]).toStrictEqual(["failed_check", "config_moved"]);
  });

  it("refuses a patch the config refuses, and stores nothing", async () => {
    const config = fakeConfig({ previewRefusal: "config.secret_inline" });
    const test = await startTestEngine({ configChanges: config });
    expect(await propose(test)).toStrictEqual(err("config.secret_inline"));
    expect(
      await test.stores.intents.list({ states: ["awaiting_confirmation"], limit: 5 }, live),
    ).toStrictEqual([]);
  });

  it("marks the agent's proposal from a turn that read outside content, and never lets an MCP client propose", async () => {
    const test = await startTestEngine({ configChanges: fakeConfig({}) });
    const marked = { ...testCallers.runtime, turn: { hasOutsideContent: true } };
    const intent = await proposed(test, marked);
    expect((await test.stores.intents.get(intent, live))?.hasOutsideContent).toBe(true);
    expect(await propose(test, testCallers.mcp)).toStrictEqual(err("auth.scope"));
  });

  it("refuses every change while the breaker holds, previewing nothing", async () => {
    const config = fakeConfig({});
    const breaker = createMemoryBreaker();
    const test = await startTestEngine({ configChanges: config, breaker });
    breaker.pull(1);
    await test.engine.followBreaker(live);
    expect(await propose(test)).toStrictEqual(err("safety.breaker"));
    expect(await propose(test, testCallers.runtime)).toStrictEqual(err("safety.breaker"));
    expect(config.previewed).toStrictEqual([]);
  });

  it("applies a change a stop left confirmed before it proposes the next one", async () => {
    const config = fakeConfig({ isFirstStopped: true });
    const test = await startTestEngine({ configChanges: config });
    const intent = await proposed(test);
    await expect(tap(test, intent)).rejects.toThrow("The engine stopped.");
    expect(await stateOf(test, intent)).toBe("confirmed");
    await proposed(test);
    expect([await stateOf(test, intent), config.applied.length]).toStrictEqual(["reconciled", 1]);
  });

  it("reads the config and the rules of its keys, and refuses a path the config does not have", async () => {
    const test = await startTestEngine({ configChanges: fakeConfig({}) });
    const view = test.engine.handlers["config/view"];
    expect(await view?.(testCall({ path: "logging.level" }))).toMatchObject({
      ok: true,
      value: { value: "info" },
    });
    expect(await view?.(testCall({ path: "nowhere" }))).toStrictEqual(err("protocol.bad_args"));
  });

  it("hands the preview the hash the patch was made from and the lists it may shorten", async () => {
    const config = fakeConfig({});
    const test = await startTestEngine({ configChanges: config });
    const hash = "a".repeat(64);
    const asked = { patch, baseHash: hash, replacePaths: ["models.imageInput"] };
    expectOk(await proposeOf(test)(testCall(asked)));
    expectOk(await proposeOf(test)(testCall({ patch })));
    expect(config.previewed).toStrictEqual([
      { baseHash: hash, replacePaths: ["models.imageInput"] },
      {},
    ]);
  });

  it("serves neither operation without a config file", async () => {
    const test = await startTestEngine();
    expect([
      test.engine.handlers["config/view"],
      test.engine.handlers["config/propose"],
    ]).toStrictEqual([undefined, undefined]);
  });
});

describe("the agent a config change belongs to", () => {
  it("is the agent named, which must be stored and not archived, with a wallet", async () => {
    const test = await startTestEngine({ configChanges: fakeConfig({}) });
    const call = async (agent: string) =>
      proposeOf(test)(testCall({ patch, agent: idSchema("agt").parse(agent) }));
    expectOk(await call(testAgent));
    await test.stores.agents.create(testAgentDraft({ id: walletless, name: "walletless" }), live);
    expect(await call(walletless)).toStrictEqual(err("agent.not_found"));
    expect(await call(unknownAgent)).toStrictEqual(err("agent.not_found"));
  });

  it("refuses an archived agent, and asks which agent when the install has two", async () => {
    const archived = await startTestEngine({
      configChanges: fakeConfig({}),
      agents: listedArchived,
    });
    const two = await startTestEngine({ configChanges: fakeConfig({}) });
    await two.stores.agents.create(testAgentDraft({ id: walletless, name: "second" }), live);
    const archivedAnswer = await proposeOf(archived)(testCall({ patch, agent: testAgent }));
    expect([archivedAnswer, await propose(two)]).toStrictEqual([
      err("agent.archived"),
      err("protocol.bad_args"),
    ]);
  });
});

describe("what a config change proposes", () => {
  it("refuses a patch that changes nothing, or more than 20 keys", async () => {
    const none = await startTestEngine({ configChanges: fakeConfig({ changes: [] }) });
    const many = await startTestEngine({
      configChanges: fakeConfig({ changes: Array.from({ length: 21 }, () => change) }),
    });
    expect([await propose(none), await propose(many)]).toStrictEqual([
      err("protocol.bad_args"),
      err("protocol.bad_args"),
    ]);
  });

  it("shows no reason when none was given, applies with none, and ends with the settings receipt", async () => {
    const config = fakeConfig({});
    const test = await startTestEngine({ configChanges: config });
    const { intent } = expectOk(await proposeOf(test)(testCall({ patch })));
    const lines = (await cardOf(test, intent))?.lines.map(({ key }) => key);
    expect(lines).not.toContain("card.reason");
    expectOk(await tap(test, intent));
    expect(config.applied[0]?.reason).toBeUndefined();
    const view = expectOk(await test.engine.handlers["intent/get"](testCall({ intent })));
    expect(view.receipt).toStrictEqual({
      key: "receipt.configChanged",
      values: { count: { type: "count", count: 1 }, restart: { type: "choice", choice: "no" } },
    });
  });
});
