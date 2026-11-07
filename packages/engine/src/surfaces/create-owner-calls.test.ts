import { createFakeTxSimulator } from "@binference/chain/testing";
import { BinferenceError, ok } from "@binference/core";
import { type ArgsOf, operations, takesOwnerKey } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { ConfigChanges } from "../config-changes/config-change-parts.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine } from "../operations/test-engine.js";
import { rescueCustody, rescueSteps, setUpRescue, testHeld } from "../safety/test-rescue.js";
import {
  createOwnerCalls,
  type OwnerCalls,
  type OwnerChatHandlers,
  ownerChatOperations,
  ownerChatScopes,
} from "./create-owner-calls.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;

// The calls for an install whose owner is `owner.id`, or with no owner paired yet.
function callsOf(
  handlers: OwnerChatHandlers,
  owner: { readonly id?: number } = { id: ownerId },
): OwnerCalls {
  return createOwnerCalls({ handlers, ownerId: async () => Promise.resolve(owner.id) });
}

// Handlers whose `engine/status` throws a fault with this code.
function throwing(code: `${string}.${string}`): OwnerChatHandlers {
  return {
    "engine/status": async () => {
      await Promise.resolve();
      throw new BinferenceError({ code, message: "The fixture fails." });
    },
  };
}

async function rescuing(): Promise<TestEngine> {
  const test = await startTestEngine({
    custodyWallets: rescueCustody,
    held: testHeld,
    chainSimulator: createFakeTxSimulator(rescueSteps()),
  });
  await setUpRescue(test);
  return test;
}

// The two the chat runs past its scopes: a few settings at once, and any other through a card.
const beyondScopes: ReadonlySet<string> = new Set(["config/change", "config/propose"]);

describe("the owner's calls from Telegram", () => {
  it.each(ownerChatOperations.filter((op) => !beyondScopes.has(op)))(
    "runs %s, a read, a brake or a message the owner sends in the chat",
    (op) => {
      const operation = operations[op];
      expect([
        ownerChatScopes.includes(operation.scope),
        operation.transport,
        takesOwnerKey(operation),
      ]).toStrictEqual([true, "any", false]);
    },
  );

  it("proposes a setting change as the owner on Telegram, which waits for the owner's tap", async () => {
    const change = { path: "owner.timezone", before: '"UTC"', after: '"Asia/Shanghai"' };
    const configChanges: ConfigChanges = {
      view: async () => Promise.resolve(ok({ rules: [] })),
      preview: async () => Promise.resolve(ok({ changes: [change], restartNeeded: false })),
      apply: async () => Promise.resolve(ok(undefined)),
    };
    const test = await startTestEngine({ configChanges });
    const calls = callsOf(test.engine.handlers);
    const patch = { owner: { timezone: "Asia/Shanghai" } };
    const proposal = { op: "config/propose", args: { patch }, senderId: ownerId } as const;
    const view = expectOk(await calls.call(proposal, live));
    expect([view.kind, view.state, view.outsideContent]).toStrictEqual([
      "configChange",
      "awaiting_confirmation",
      false,
    ]);
  });

  it("posts the owner's message to the agent as one written in Telegram", async () => {
    const test = await startTestEngine();
    const calls = callsOf(test.engine.handlers);
    const post = {
      op: "chat/post",
      args: { agent: testAgent, text: "What moved today?" },
    } as const;
    expectOk(await calls.call({ ...post, senderId: ownerId }, live));
    await expect(calls.call({ ...post, senderId: ownerId + 1 }, live)).resolves.toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(test.pushes.filter((push) => push.topic === "inbox")).toMatchObject([
      { kind: "inbox/message", data: { text: "What moved today?", surface: "telegram" } },
    ]);
  });

  it("tightens a limit at once as the owner on Telegram, and never loosens one", async () => {
    const test = await startTestEngine();
    const calls = callsOf(test.engine.handlers);
    const set = (perTradeUsdMicros: bigint) =>
      calls.call(
        {
          op: "limit/set",
          args: { agent: testAgent, changes: { perTradeUsdMicros } },
          senderId: ownerId,
        },
        live,
      );
    const before = expectOk(
      await calls.call({ op: "limit/get", args: { agent: testAgent }, senderId: ownerId }, live),
    ).perTradeUsdMicros;
    const tighter = expectOk(await set(before / 2n));
    expect([tighter.perTradeUsdMicros, tighter.pending]).toStrictEqual([before / 2n, undefined]);
    await expect(set(before * 2n)).resolves.toStrictEqual({ ok: false, error: "auth.scope" });
    expect(test.pushes.filter((push) => push.kind === "notice/new")).toMatchObject([
      { data: { key: "notice.limitChange", values: { surface: "telegram", pending: "no" } } },
    ]);
  });

  it("changes how replies and reasoning show past the admin scope, one key at a time", async () => {
    const seen: unknown[] = [];
    const handlers: OwnerChatHandlers = {
      "config/change": async ({ args }) => {
        seen.push(args.patch);
        return Promise.resolve(ok({ config: {}, restartNeeded: false }));
      },
    };
    const change = async (patch: Readonly<ArgsOf<"config/change">["patch"]>) =>
      callsOf(handlers).call({ op: "config/change", args: { patch }, senderId: ownerId }, live);
    const allowed = [
      { telegram: { replies: { reasoning: "streamed" } } },
      { telegram: { replies: { stream: "partial" } } },
    ];
    const refused = [
      { telegram: { replies: { reasoning: "loud" } } },
      { telegram: { replies: { stream: "partial", reasoning: "kept" } } },
      { telegram: { topicsPerAgent: true } },
    ];
    const answers = await Promise.all([...allowed, ...refused].map(change));
    expect(answers.map((answer) => answer.ok)).toStrictEqual([true, true, false, false, false]);
    expect(seen).toStrictEqual(allowed);
  });

  it("changes the owner's language past the admin scope, and no other setting", async () => {
    const seen: unknown[] = [];
    const handlers: OwnerChatHandlers = {
      "config/change": async ({ args, caller }) => {
        seen.push([args.patch, caller.scopes]);
        return Promise.resolve(ok({ config: {}, restartNeeded: false }));
      },
    };
    const change = async (patch: Readonly<ArgsOf<"config/change">["patch"]>) =>
      callsOf(handlers).call({ op: "config/change", args: { patch }, senderId: ownerId }, live);
    expect(operations["config/change"].scope).toBe("admin");
    await expect(change({ owner: { locale: "zh" } })).resolves.toMatchObject({ ok: true });
    const others: readonly ArgsOf<"config/change">["patch"][] = [
      { owner: { locale: "zh", timezone: "UTC" } },
      { owner: { locale: "fr" } },
      { logging: { level: "debug" } },
    ];
    const refused = await Promise.all(others.map(async (patch) => change(patch)));
    expect(refused.map((result) => result.ok)).toStrictEqual([false, false, false]);
    expect(seen).toStrictEqual([[{ owner: { locale: "zh" } }, ["read", "confirm", "chat"]]]);
  });

  it("freezes every agent as the owner on Telegram, and the notice names Telegram", async () => {
    const test = await startTestEngine();
    const frozen = await callsOf(test.engine.handlers).call(
      { op: "safety/freeze", args: {}, senderId: ownerId },
      live,
    );
    expect(frozen.ok).toBe(true);
    expect(test.pushes.filter((push) => push.kind === "notice/new")).toMatchObject([
      { data: { key: "notice.frozen", values: { surface: "telegram" } } },
    ]);
  });

  it("runs nothing for another sender, or before the owner pairs", async () => {
    const test = await startTestEngine();
    const freeze = { op: "safety/freeze", args: {}, senderId: ownerId } as const;
    await expect(
      callsOf(test.engine.handlers, { id: 42 }).call(freeze, live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    await expect(callsOf(test.engine.handlers, {}).call(freeze, live)).resolves.toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    const status = await test.engine.handlers["safety/status"]({
      args: {},
      caller: { credential: "tg:1", client: { kind: "telegram" }, scopes: ["read"] },
      ...live,
    });
    expect(expectOk(status).frozen).toBe(false);
  });

  it("opens the rescue as the owner while every agent is frozen", async () => {
    const test = await rescuing();
    const calls = callsOf(test.engine.handlers);
    await calls.call({ op: "safety/freeze", args: {}, senderId: ownerId }, live);
    const rescue = expectOk(
      await calls.call({ op: "safety/rescue", args: {}, senderId: ownerId }, live),
    );
    const record = await test.stores.intents.get(rescue.intent, live);
    expect([record?.kind, record?.state, record?.proposer]).toStrictEqual([
      "rescue",
      "awaiting_confirmation",
      "telegram",
    ]);
  });

  it("answers the unknown operation code for an operation the engine does not serve yet", async () => {
    const test = await startTestEngine();
    const read = { op: "engine/status", args: {}, senderId: ownerId } as const;
    await expect(callsOf(test.engine.handlers).call(read, live)).resolves.toStrictEqual({
      ok: false,
      error: "protocol.unknown_op",
    });
  });

  it("answers a fault with a protocol code by its code, and throws any other fault", async () => {
    const status = { op: "engine/status", args: {}, senderId: ownerId } as const;
    await expect(callsOf(throwing("engine.locked")).call(status, live)).resolves.toStrictEqual({
      ok: false,
      error: "engine.locked",
    });
    await expect(callsOf(throwing("store.broken")).call(status, live)).rejects.toThrow(
      "The fixture fails.",
    );
    const served: OwnerChatHandlers = {
      "safety/status": async () => Promise.resolve(ok({ frozen: true })),
    };
    await expect(
      callsOf(served).call({ op: "safety/status", args: {}, senderId: ownerId }, live),
    ).resolves.toStrictEqual({ ok: true, value: { frozen: true } });
  });
});
