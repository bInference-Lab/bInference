import { decimalStringSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
  type ManualClock,
} from "@binference/core/testing";
import {
  type ArgsOf,
  type Credential,
  type OperationShapes,
  type OperationTable,
  operations,
  protocolVersion,
  readyFrameSchema,
  type ResultOf,
} from "@binference/protocol";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createFakeEngine, type FakeEngine } from "./fake-engine.js";
import { createProtocolClient, type ProtocolClient } from "./protocol-client.js";

interface TestShapes extends Pick<OperationShapes, "log/follow" | "log/unfollow"> {
  readonly "intent/get": {
    readonly args: { readonly intent: string };
    readonly result: { readonly state: string };
  };
  readonly "intent/propose": {
    readonly args: { readonly agent: string; readonly reason: string };
    readonly result: { readonly intent: string };
  };
  readonly "amount/double": {
    readonly args: { readonly base: bigint };
    readonly result: { readonly base: bigint };
  };
}

const readFlags = {
  kind: "read",
  idempotency: "none",
  transport: "any",
  answeredBy: "engine",
  since: "2026.10.0",
} as const;

// A small table for behavior; the protocol's own subscribe operations keep their real schemas.
const testOperations: OperationTable<TestShapes> = {
  "intent/get": {
    ...readFlags,
    name: "intent/get",
    scope: "read",
    args: z.object({ intent: z.string() }),
    result: z.object({ state: z.string() }),
  },
  "intent/propose": {
    ...readFlags,
    kind: "write",
    idempotency: "key",
    name: "intent/propose",
    scope: "propose",
    args: z.object({ agent: z.string(), reason: z.string() }),
    result: z.object({ intent: z.string() }),
  },
  "amount/double": {
    ...readFlags,
    name: "amount/double",
    scope: "read",
    args: z.object({ base: decimalStringSchema }),
    result: z.object({ base: decimalStringSchema }),
  },
  "log/follow": operations["log/follow"],
  "log/unfollow": operations["log/unfollow"],
};

const token: Credential = { token: `bnt_${"a".repeat(43)}` };
const ready = readyFrameSchema.parse({
  t: "ready",
  v: protocolVersion,
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  scopes: ["read", "propose"],
  engine: { version: "2026.10.0", protocol: protocolVersion, state: "ready" },
  owner: { locale: "en", timezone: "Asia/Shanghai" },
});
const signal = new AbortController().signal;
const open = { t: "open", v: protocolVersion, client: { kind: "cli", version: "0.1.0" } };

function setup() {
  const engine = createFakeEngine();
  const clock = createManualClock(1_000);
  const logger = createMemoryLogger({ subsystem: "client" });
  const client = createProtocolClient({
    operations: testOperations,
    openSocket: engine.openSocket,
    client: { kind: "cli", version: "0.1.0" },
    credential: token,
    clock,
    random: createSeededRandom(7),
    logger,
    limits: { callTimeoutMs: 5_000 },
  });
  return { engine, clock, logger, client };
}

// Opens the newest socket and answers its `open` with `ready`.
async function signIn(engine: FakeEngine, clock: ManualClock) {
  const socket = engine.latest();
  socket.accept();
  socket.deliver(ready);
  await clock.advance(0);
  return socket;
}

async function connected() {
  const context = setup();
  const opening = context.client.connect(signal);
  const socket = await signIn(context.engine, context.clock);
  await opening;
  return { ...context, socket };
}

function callsSent(socket: ReturnType<FakeEngine["latest"]>) {
  return socket.sent().filter((frame) => frame.t === "call");
}

describe("createProtocolClient", () => {
  it("signs in with open and resolves connect at ready", async () => {
    const { engine, clock, client } = setup();
    expect(client.status()).toStrictEqual({ state: "idle" });
    const result = client.connect(signal);
    expect(client.status()).toStrictEqual({ state: "connecting" });
    const socket = await signIn(engine, clock);
    await expect(result).resolves.toStrictEqual(ready);
    expect(socket.sent()).toStrictEqual([{ ...open, auth: token }]);
    expect(client.status()).toStrictEqual({ state: "ready", ready });
    await expect(client.connect(signal)).resolves.toStrictEqual(ready);
  });

  it("closes for good when the first connection fails for good", async () => {
    const { engine, clock, client } = setup();
    const result = client.connect(signal);
    engine.latest().accept();
    engine.latest().deliver({ ...ready, v: 2 });
    await expect(result).rejects.toMatchObject({ code: "protocol.version" });
    await clock.advance(60_000);
    expect(engine.sockets()).toHaveLength(1);
    expect(client.status()).toMatchObject({ state: "closed", error: { code: "protocol.version" } });
  });

  it("closes for good at a bye with an auth code and rejects every waiting call with it", async () => {
    const { engine, clock, client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    socket.deliver({ t: "bye", code: "auth.revoked", message: "Revoked." });
    socket.drop(1000);
    await expect(call).rejects.toMatchObject({ code: "auth.revoked", retryable: false });
    await clock.advance(60_000);
    expect(engine.sockets()).toHaveLength(1);
    await expect(client.call("intent/get", { intent: "int_1" }, { signal })).rejects.toMatchObject({
      code: "auth.revoked",
    });
  });

  it("resolves a call with its parsed result and sends a key only with a write", async () => {
    const { client, socket } = await connected();
    const read = client.call("intent/get", { intent: "int_1" }, { signal, key: "ignored" });
    const write = client.call(
      "intent/propose",
      { agent: "agt_1", reason: "rebalance" },
      { signal },
    );
    socket.deliver({ t: "reply", id: "2", result: { intent: "int_2", extra: true } });
    socket.deliver({ t: "reply", id: "1", result: { state: "settled" } });
    await expect(read).resolves.toStrictEqual({ state: "settled" });
    await expect(write).resolves.toStrictEqual({ intent: "int_2" });
    const [readFrame, writeFrame] = callsSent(socket);
    expect(readFrame).toStrictEqual({
      t: "call",
      id: "1",
      op: "intent/get",
      args: { intent: "int_1" },
    });
    expect(JSON.stringify(writeFrame)).toMatch(/"id":"2".*"key":"key_[0-9a-f-]{36}"/);
  });

  it("encodes args and parses results through their codecs", async () => {
    const { client, socket } = await connected();
    const doubled = client.call("amount/double", { base: 2n ** 70n }, { signal });
    expect(callsSent(socket)[0]).toMatchObject({ args: { base: "1180591620717411303424" } });
    socket.deliver({ t: "reply", id: "1", result: { base: "2361183241434822606848" } });
    await expect(doubled).resolves.toStrictEqual({ base: 2n ** 71n });
  });

  it("rejects with the engine's error from a fail frame", async () => {
    const { client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    const error = {
      code: "intent.not_found",
      message: "No such intent.",
      retryable: false,
    } as const;
    socket.deliver({ t: "fail", id: "1", error: { ...error, details: { ref: "log-7" } } });
    await expect(call).rejects.toMatchObject({ ...error, details: { ref: "log-7" } });
  });

  it("rejects a result that breaks its schema as a bad reply", async () => {
    const { client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    socket.deliver({ t: "reply", id: "1", result: { state: 7 } });
    await expect(call).rejects.toMatchObject({
      code: "client.bad_reply",
      details: { op: "intent/get" },
    });
  });

  it("refuses args that break their schema and sends nothing", async () => {
    const { client, socket } = await connected();
    const bad = { intent: 7 } as never;
    await expect(client.call("intent/get", bad, { signal })).rejects.toMatchObject({
      code: "protocol.bad_args",
    });
    expect(callsSent(socket)).toStrictEqual([]);
  });

  it("times out a call, then drops its late answer", async () => {
    const { clock, client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal, timeoutMs: 100 });
    await clock.advance(100);
    await expect(call).rejects.toMatchObject({ code: "core.timeout", retryable: true });
    socket.deliver({ t: "reply", id: "1", result: { state: "settled" } });
    const next = client.call("intent/get", { intent: "int_2" }, { signal });
    socket.deliver({ t: "reply", id: "2", result: { state: "open" } });
    await expect(next).resolves.toStrictEqual({ state: "open" });
  });

  it("stops waiting when the caller aborts", async () => {
    const { client } = await connected();
    const controller = new AbortController();
    const call = client.call("intent/get", { intent: "int_1" }, { signal: controller.signal });
    controller.abort(new Error("Left the page."));
    await expect(call).rejects.toThrow("Left the page.");
  });

  it("resumes the calls in flight on a new socket after the old one drops", async () => {
    const { engine, clock, client, socket, logger } = await connected();
    const read = client.call("intent/get", { intent: "int_1" }, { signal });
    const write = client.call(
      "intent/propose",
      { agent: "agt_1", reason: "rebalance" },
      { signal },
    );
    const inFlight = callsSent(socket);
    socket.drop();
    await clock.advance(0);
    expect(client.status()).toStrictEqual({ state: "connecting" });
    const next = await signIn(engine, clock);
    expect(next).not.toBe(socket);
    expect(callsSent(next)).toStrictEqual(inFlight);
    next.deliver({ t: "reply", id: "1", result: { state: "settled" } });
    next.deliver({ t: "reply", id: "2", result: { intent: "int_2" } });
    await expect(read).resolves.toStrictEqual({ state: "settled" });
    await expect(write).resolves.toStrictEqual({ intent: "int_2" });
    expect(logger.records().map((record) => [record.event, record.fields])).toStrictEqual([
      ["client.ready", {}],
      ["client.reconnecting", { errorCode: "client.disconnected" }],
      ["client.ready", {}],
    ]);
  });

  it("sends a call made while the socket is down once the next connection is ready", async () => {
    const { engine, clock, client, socket } = await connected();
    socket.deliver({ t: "bye", code: "engine.stopping", message: "Restarting." });
    socket.drop(1000);
    await clock.advance(0);
    engine.latest().drop();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    await clock.advance(1_000);
    const next = await signIn(engine, clock);
    expect(engine.sockets()).toHaveLength(3);
    expect(callsSent(next)).toStrictEqual([
      { t: "call", id: "1", op: "intent/get", args: { intent: "int_1" } },
    ]);
    next.deliver({ t: "reply", id: "1", result: { state: "settled" } });
    await expect(call).resolves.toStrictEqual({ state: "settled" });
  });

  it("closes for good when the engine refuses a reconnect", async () => {
    const { engine, clock, client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    socket.drop();
    await clock.advance(0);
    engine.latest().accept();
    engine.latest().deliver({ t: "bye", code: "auth.expired", message: "Expired." });
    engine.latest().drop(1008);
    await expect(call).rejects.toMatchObject({ code: "auth.expired" });
    await clock.advance(60_000);
    expect(engine.sockets()).toHaveLength(2);
    expect(client.status()).toMatchObject({ state: "closed", error: { code: "auth.expired" } });
  });

  it("gives up a handshake that never reaches ready and tries again", async () => {
    const { engine, clock, client } = setup();
    const result = client.connect(signal);
    engine.latest().accept();
    await clock.advance(10_000);
    expect(engine.sockets()[0]?.readyState).toBe(3);
    await clock.advance(1_000);
    expect(engine.sockets()).toHaveLength(2);
    await signIn(engine, clock);
    await expect(result).resolves.toStrictEqual(ready);
  });

  it("subscribes through the protocol's push operations and resumes the topic after a reconnect", async () => {
    const { engine, clock, client, socket } = await connected();
    const seen: number[] = [];
    const refetch = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => undefined);
    const unsubscribe = client.subscribe("intent", {
      onPush: (push) => seen.push(push.seq),
      refetch,
    });
    expect(callsSent(socket)).toStrictEqual([
      { t: "call", id: "1", op: "push/subscribe", args: { topics: { intent: {} } } },
    ]);
    socket.deliver({ t: "reply", id: "1", result: { seqs: { intent: 2 } } });
    await clock.advance(0);
    socket.deliver({ t: "push", topic: "intent", seq: 3, kind: "intent/changed", data: {} });
    socket.drop();
    await clock.advance(0);
    const next = await signIn(engine, clock);
    expect(callsSent(next)).toStrictEqual([
      { t: "call", id: "2", op: "push/subscribe", args: { topics: { intent: { fromSeq: 4 } } } },
    ]);
    expect(seen).toStrictEqual([3]);
    expect(refetch).toHaveBeenCalledOnce();
    unsubscribe();
    expect(callsSent(next).at(-1)).toStrictEqual({
      t: "call",
      id: "3",
      op: "push/unsubscribe",
      args: { topics: ["intent"] },
    });
  });

  it("makes the last subscribe call of each operation again on every new connection", async () => {
    const { engine, clock, client, socket } = await connected();
    const calls = [
      client.call("log/follow", { level: "info" }, { signal }),
      client.call("log/follow", { level: "warn" }, { signal }),
      client.call("log/unfollow", {}, { signal }),
      client.call("intent/get", { intent: "int_1" }, { signal }),
    ];
    ["1", "2", "3", "4"].forEach((id) => socket.deliver({ t: "reply", id, result: {} }));
    await Promise.allSettled(calls);
    socket.drop();
    await clock.advance(0);
    const next = await signIn(engine, clock);
    expect(callsSent(next)).toStrictEqual([
      { t: "call", id: "5", op: "log/follow", args: { level: "warn" } },
      { t: "call", id: "6", op: "log/unfollow", args: {} },
    ]);
  });

  it("closes for good: rejects waiting calls, refuses new ones and never reconnects", async () => {
    const { engine, clock, client, socket } = await connected();
    const call = client.call("intent/get", { intent: "int_1" }, { signal });
    client.close();
    await expect(call).rejects.toMatchObject({ code: "client.closed" });
    await expect(client.call("intent/get", { intent: "int_1" }, { signal })).rejects.toMatchObject({
      code: "client.closed",
    });
    const handlers = { onPush: vi.fn<() => void>(), refetch: vi.fn<() => Promise<void>>() };
    expect(() => client.subscribe("intent", handlers)).toThrow(
      expect.objectContaining({ code: "client.closed" }),
    );
    await clock.advance(60_000);
    expect(socket.readyState).toBe(3);
    expect(engine.sockets()).toHaveLength(1);
    expect(client.status()).toMatchObject({ state: "closed", error: { code: "client.closed" } });
  });

  it("types each call's args and result from the operation table", () => {
    const { client } = setup();
    expectTypeOf<Parameters<typeof client.call>[0]>().toEqualTypeOf<keyof TestShapes>();
    expectTypeOf<typeof client.call<"intent/get">>()
      .parameter(1)
      .toEqualTypeOf<{ readonly intent: string }>();
    expectTypeOf<typeof client.call<"amount/double">>().returns.resolves.toEqualTypeOf<{
      readonly base: bigint;
    }>();
  });

  it("types every call of the protocol's table from ArgsOf and ResultOf", () => {
    const engine = createFakeEngine();
    const clock = createManualClock(1_000);
    const client = createProtocolClient({
      operations,
      openSocket: engine.openSocket,
      client: { kind: "mcp", version: "0.1.0" },
      credential: token,
      clock,
      random: createSeededRandom(7),
      logger: createMemoryLogger({ subsystem: "client" }),
    });
    expectTypeOf(client).toEqualTypeOf<ProtocolClient>();
    expectTypeOf<typeof client.call<"intent/propose">>()
      .parameter(1)
      .toEqualTypeOf<ArgsOf<"intent/propose">>();
    expectTypeOf<typeof client.call<"intent/propose">>().returns.resolves.toEqualTypeOf<
      ResultOf<"intent/propose">
    >();
    expectTypeOf<Extract<Parameters<typeof client.call>[0], "push/subscribe">>().toBeNever();
    expect(engine.sockets()).toStrictEqual([]);
  });
});
