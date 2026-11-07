import { createIdSource, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "../chat/running-turns.js";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryCredentialStore } from "../fakes/memory-credential-store.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createCredentialRequestHandlers } from "./credential-request-handlers.js";
import { createCredentialStoreHandlers } from "./credential-store-handlers.js";

const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const owner = testCallers.cli;

async function setUp(given: { readonly store?: "none" } = {}) {
  const clock = createManualClock(1_760_000_000_000);
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const agentInbox = createMemoryAgentInboxStore({ agents });
  const credentials = createMemoryCredentialStore();
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(testCallers.runtime.credential));
  const pushes: EnginePush[] = [];
  const options = {
    agentInbox,
    turns,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    clock,
    publish: (push: EnginePush) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
    ...(given.store === "none" ? {} : { credentials }),
  };
  const handlers = {
    ...createCredentialRequestHandlers(options),
    ...createCredentialStoreHandlers(options),
  };
  const ask = async (more: Readonly<Record<string, string | number | readonly string[]>> = {}) =>
    handlers["turn/credential"](
      testCall(
        {
          agent: testAgent,
          session,
          turn,
          name: "DUNE_API_KEY",
          reason: "Holder history.",
          ...more,
        },
        testCallers.runtime,
      ),
    );
  const kinds = () =>
    pushes.filter((push) => push.topic.startsWith("chat:")).map((push) => push.kind);
  return { clock, handlers, ask, pushes, kinds, agentInbox, credentials };
}

describe("the agent's credential requests", () => {
  it("asks the owner, stores the owner's value with the hosts kept, and wakes the agent without it", async () => {
    const test = await setUp();
    const request = expectOk(await test.ask({ allowedHosts: ["api.dune.com"] }));
    expect(request).toMatchObject({
      name: "DUNE_API_KEY",
      allowedHosts: ["api.dune.com"],
      closesAt: test.clock.now() + 900_000,
    });
    const args = {
      agent: testAgent,
      request: request.request,
      value: "s3cret-value",
      allowedHosts: ["api.dune.com"],
    };
    expectOk(await test.handlers["credential/answer"](testCall(args, owner)));
    expect(test.kinds()).toStrictEqual(["chat/credentialRequest", "chat/credentialRequestClosed"]);
    expect(
      test.pushes.find((push) => push.kind === "chat/credentialRequestClosed")?.data,
    ).toMatchObject({
      outcome: "stored",
    });
    expect(await test.credentials.get("DUNE_API_KEY", testCall({}))).toMatchObject({
      allowedHosts: ["api.dune.com"],
    });
    const inbox = test.pushes.filter((push) => push.topic === "inbox");
    expect(JSON.stringify(inbox)).toContain("the owner stored the credential DUNE_API_KEY");
    expect(JSON.stringify(test.pushes)).not.toContain("s3cret-value");
    expect(await test.handlers["credential/answer"](testCall(args, owner))).toStrictEqual({
      ok: false,
      error: "credential.closed",
    });
  });

  it("tells the agent no credential arrived when the owner skips", async () => {
    const test = await setUp();
    const request = expectOk(await test.ask());
    expectOk(
      await test.handlers["credential/skip"](
        testCall({ agent: testAgent, request: request.request }, owner),
      ),
    );
    expect(test.pushes.at(-2)?.data).toMatchObject({ outcome: "skipped" });
    expect(JSON.stringify(test.pushes.at(-1))).toContain("no credential arrived");
  });

  it("starts with the stored hosts, replaces an open request, and closes one past its 15 minutes", async () => {
    const test = await setUp();
    await test.handlers["credential/set"](
      testCall({ name: "DUNE_API_KEY", value: "v", allowedHosts: ["a.example.com"] }, owner),
    );
    const first = expectOk(await test.ask());
    expect(first).toMatchObject({ allowedHosts: ["a.example.com"], updatedAt: test.clock.now() });
    const second = expectOk(await test.ask());
    expect(
      test.pushes.find((push) => push.kind === "chat/credentialRequestClosed")?.data,
    ).toMatchObject({ request: first.request, outcome: "replaced" });
    expect(
      expectOk(
        await test.handlers["chat/openCredentialRequest"](testCall({ agent: testAgent }, owner)),
      ),
    ).toStrictEqual({ request: second });
    await test.clock.advance(900_000);
    expect(
      expectOk(
        await test.handlers["chat/openCredentialRequest"](testCall({ agent: testAgent }, owner)),
      ),
    ).toStrictEqual({});
    expect(test.pushes.at(-1)?.data).toMatchObject({ outcome: "expired" });
  });

  it("closes a request at the time the agent named, with no read", async () => {
    const test = await setUp();
    expectOk(await test.ask({ timeoutSeconds: 30 }));
    await test.clock.advance(29_999);
    expect(test.kinds()).toStrictEqual(["chat/credentialRequest"]);
    await test.clock.advance(1);
    expect(test.kinds()).toStrictEqual(["chat/credentialRequest", "chat/credentialRequestClosed"]);
    expect(test.pushes.at(-1)?.data).toMatchObject({ outcome: "expired" });
  });

  it("answers an open request when the owner stores a credential of its name with no request", async () => {
    const test = await setUp();
    expectOk(await test.ask());
    expectOk(
      await test.handlers["credential/set"](
        testCall({ name: "DUNE_API_KEY", value: "v", allowedHosts: ["api.dune.com"] }, owner),
      ),
    );
    expect(
      test.pushes.find((push) => push.kind === "chat/credentialRequestClosed")?.data,
    ).toMatchObject({
      outcome: "stored",
    });
    expect(JSON.stringify(test.pushes.filter((push) => push.topic === "inbox"))).toContain(
      "the owner stored the credential DUNE_API_KEY",
    );
    expect(
      expectOk(
        await test.handlers["chat/openCredentialRequest"](testCall({ agent: testAgent }, owner)),
      ),
    ).toStrictEqual({});
  });

  it("asks with no reason, wakes the agent with no host kept, and refuses an answer to a closed request", async () => {
    const test = await setUp();
    const request = expectOk(
      await test.handlers["turn/credential"](
        testCall({ agent: testAgent, session, turn, name: "X_KEY" }, testCallers.runtime),
      ),
    );
    expect(request.reason).toBeUndefined();
    const answer = { agent: testAgent, request: request.request, value: "v", allowedHosts: [] };
    expectOk(await test.handlers["credential/answer"](testCall(answer, owner)));
    expect(JSON.stringify(test.pushes.at(-1))).toContain("it may be sent to no host yet");
    const skip = { agent: testAgent, request: request.request };
    expect(await test.handlers["credential/skip"](testCall(skip, owner))).toStrictEqual({
      ok: false,
      error: "credential.closed",
    });
  });

  it("refuses an answer for an agent the inbox does not hold", async () => {
    const test = await setUp();
    const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const request = expectOk(
      await test.handlers["turn/credential"](
        testCall({ agent: other, session, turn, name: "X_KEY" }, testCallers.runtime),
      ),
    );
    const answer = { agent: other, request: request.request, value: "v", allowedHosts: [] };
    expect(await test.handlers["credential/answer"](testCall(answer, owner))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
  });

  it("refuses an answer with busy while the agent's inbox is full, and stores nothing", async () => {
    const test = await setUp();
    const request = expectOk(await test.ask());
    const posts = Array.from({ length: 200 }, async (_, n) =>
      test.agentInbox.add(
        {
          id: idSchema("msg").parse(`msg_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`),
          agentId: testAgent,
          kind: "inbox/message",
          payload: { text: `m${String(n)}`, surface: "cli" },
          atMs: test.clock.now(),
          opens: session,
        },
        { signal: new AbortController().signal },
      ),
    );
    expect((await Promise.all(posts)).every((added) => added.ok)).toBe(true);
    const skip = { agent: testAgent, request: request.request };
    expect(await test.handlers["credential/skip"](testCall(skip, owner))).toStrictEqual({
      ok: false,
      error: "protocol.busy",
    });
  });

  it("answers only the current runtime, and refuses when no store holds credentials", async () => {
    const test = await setUp();
    const args = { agent: testAgent, session, turn, name: "X_KEY" };
    expect(await test.handlers["turn/credential"](testCall(args, owner))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    const bare = await setUp({ store: "none" });
    expect(await bare.ask()).toStrictEqual({ ok: false, error: "credential.unavailable" });
    expect(expectOk(await bare.handlers["credential/list"](testCall({}, owner)))).toStrictEqual({
      items: [],
    });
    const request = idSchema("crq").parse("crq_0190f1c2-3a4b-7c5d-8e6f-000000000009");
    const answer = { agent: testAgent, request };
    expect(
      await bare.handlers["credential/answer"](
        testCall({ ...answer, value: "v", allowedHosts: [] }, owner),
      ),
    ).toStrictEqual({ ok: false, error: "credential.unavailable" });
    const set = { name: "X_KEY", value: "v", allowedHosts: [] };
    expect(await bare.handlers["credential/set"](testCall(set, owner))).toStrictEqual({
      ok: false,
      error: "credential.unavailable",
    });
    expect(
      await bare.handlers["credential/delete"](testCall({ name: "X_KEY" }, owner)),
    ).toStrictEqual({ ok: false, error: "credential.unavailable" });
  });

  it("lists names and hosts, deletes one, and never shows a value", async () => {
    const test = await setUp();
    await test.handlers["credential/set"](
      testCall({ name: "B_KEY", value: "hidden", allowedHosts: [] }, owner),
    );
    const listed = expectOk(await test.handlers["credential/list"](testCall({}, owner)));
    expect(listed).toStrictEqual({
      items: [{ name: "B_KEY", allowedHosts: [], updatedAt: test.clock.now() }],
    });
    expect(
      await test.handlers["credential/delete"](testCall({ name: "B_KEY" }, testCallers.runtime)),
    ).toStrictEqual({ ok: true, value: { name: "B_KEY" } });
    expect(
      await test.handlers["credential/delete"](testCall({ name: "B_KEY" }, testCallers.runtime)),
    ).toStrictEqual({ ok: false, error: "credential.not_found" });
  });
});
