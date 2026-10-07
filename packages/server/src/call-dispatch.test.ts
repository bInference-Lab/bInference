import { BinferenceError, createIdSource, err, ok } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import { createMemoryIdempotencyStore } from "@binference/engine/testing";
import {
  type CallFrame,
  type EngineFrame,
  type EngineState,
  operationNames,
  operations,
  ownerKeyOperations,
  protocolIdSchema,
  type Scope,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { type CallStep, createCallDispatch, isLocalOnly, type Session } from "./call-dispatch.js";
import { createIdempotentWrites } from "./idempotent-writes.js";
import type { OperationHandlers, Transport } from "./operation-handlers.js";
import { createPushHub } from "./push-hub.js";
import { describeOnce } from "./server-operations.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = protocolIdSchema("chatTurn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const cli: readonly Scope[] = ["read", "propose", "chat", "confirm", "loosen", "admin"];

interface Setup {
  readonly handlers?: OperationHandlers;
  readonly state?: EngineState;
}

function setup(options: Setup = {}): {
  readonly dispatch: ReturnType<typeof createCallDispatch>;
  readonly logger: ReturnType<typeof createMemoryLogger>;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly stop: AbortController;
} {
  const clock = createManualClock(0);
  const logger = createMemoryLogger({ subsystem: "server" });
  const stop = new AbortController();
  const dispatch = createCallDispatch({
    handlers: options.handlers ?? {},
    writes: createIdempotentWrites({
      store: createMemoryIdempotencyStore(),
      clock,
      maxInFlight: 8,
      signal: stop.signal,
    }),
    pushes: createPushHub({
      clock,
      maxPushesPerTopic: 1_000,
      pushRetentionMs: 600_000,
      maxTopics: 1_024,
      maxTopicsPerConnection: 64,
    }),
    description: describeOnce(),
    engine: {
      version: "1",
      state: () => options.state ?? "ready",
      owner: () => ({ locale: "en", timezone: "UTC" }),
    },
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(5) }),
    logger,
    callTimeoutMs: 1_000,
    signal: stop.signal,
  });
  return { dispatch, logger, clock, stop };
}

function session(scopes: readonly Scope[], transport: Transport = "ipc"): Session {
  const caller = {
    connection: protocolIdSchema("connection").parse("con_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    client: { kind: "cli", version: "test" },
    scopes,
    transport,
  } as const;
  const subscriber = { id: caller.connection, scopes, send: () => undefined };
  return { caller, subscriber, closed: new AbortController().signal };
}

async function framesOf(step: CallStep): Promise<readonly EngineFrame[]> {
  return step.kind === "answered" ? step.frames : [await step.answer];
}

function failRef(frame: EngineFrame | undefined): string | number | boolean | undefined {
  return frame?.t === "fail" ? frame.error.details?.["ref"] : undefined;
}

function replyResult(frame: EngineFrame | undefined): object {
  if (frame?.t !== "reply") {
    throw new BinferenceError({ code: "test.no_reply", message: "Expected a reply." });
  }
  return { result: frame.result };
}

// One failed answer with the code for each owner-key operation.
function failingOwnerKeyCalls(code: string): readonly object[] {
  return ownerKeyOperations.map(() => [{ t: "fail", error: { code } }]);
}

function call(op: string, args: object, key?: string): CallFrame {
  return { t: "call", id: "c1", op, args, ...(key === undefined ? {} : { key }) };
}

describe("createCallDispatch", () => {
  const ipc = { scopes: cli, transport: "ipc" } as const;

  it.each([
    {
      name: "an operation the protocol lacks",
      frame: call("made/up", {}),
      ...ipc,
      code: "protocol.unknown_op",
    },
    {
      name: "a call above the caller's scopes",
      frame: call("safety/freeze", {}, "k"),
      scopes: ["read", "propose"],
      transport: "ipc",
      code: "auth.scope",
    },
    {
      name: "a local operation over WS",
      frame: call("engine/stop", {}, "k"),
      scopes: cli,
      transport: "ws",
      code: "auth.local_only",
    },
    {
      name: "a write without a key",
      frame: call("safety/freeze", {}),
      ...ipc,
      code: "protocol.key_required",
    },
    {
      name: "args the schema refuses",
      frame: call("safety/freeze", { extra: 1 }, "k"),
      ...ipc,
      code: "protocol.bad_args",
    },
    {
      name: "an engine operation without a handler",
      frame: call("safety/status", {}),
      ...ipc,
      code: "protocol.unknown_op",
    },
  ] as const)("fails $name", async ({ frame, scopes, transport, code }) => {
    const { dispatch } = setup({ handlers: { "safety/freeze": async () => ok({ frozenAt: 1 }) } });
    await expect(framesOf(dispatch(frame, session(scopes, transport)))).resolves.toMatchObject([
      { t: "fail", id: "c1", error: { code, retryable: false } },
    ]);
  });

  it("refuses every owner-key operation over WS and lets it through over IPC", async () => {
    const { dispatch } = setup();
    const framesOver = async (transport: Transport) =>
      Promise.all(
        ownerKeyOperations.map(async (op) =>
          framesOf(dispatch(call(op, {}, "k"), session(cli, transport))),
        ),
      );
    await expect(framesOver("ws")).resolves.toMatchObject(failingOwnerKeyCalls("auth.local_only"));
    // Over IPC the call passes the transport check and fails later: this engine has no handler.
    await expect(framesOver("ipc")).resolves.toMatchObject(
      failingOwnerKeyCalls("protocol.unknown_op"),
    );
  });

  it("keeps an owner-key operation local even when its row allows any transport", () => {
    expect(isLocalOnly({ ...operations["ceiling/set"], transport: "any" })).toBe(true);
    expect(isLocalOnly(operations["engine/stop"])).toBe(true);
    expect(isLocalOnly(operations["approval/set"])).toBe(false);
  });

  it("fails a routed call while no runtime handler is there, as retryable", async () => {
    const { dispatch } = setup();
    const frame = call("chat/messages", { agent });
    await expect(framesOf(dispatch(frame, session(cli)))).resolves.toMatchObject([
      { t: "fail", error: { code: "runtime.unavailable", retryable: true } },
    ]);
  });

  it("lets a call through on its scope case, for the engine to decide", async () => {
    const intent = protocolIdSchema("intent").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const { dispatch } = setup({
      handlers: { "intent/cancel": async () => err("intent.not_yours") },
    });
    const frame = call("intent/cancel", { intent }, "k");
    await expect(framesOf(dispatch(frame, session(["read", "propose"])))).resolves.toMatchObject([
      { t: "fail", error: { code: "intent.not_yours", retryable: false } },
    ]);
  });

  it("serves only the engine status and subscriptions while starting", async () => {
    const status = {
      state: "starting",
      version: "1",
      protocol: 1,
      frozen: false,
      agents: [],
      health: [],
    } as const;
    const { dispatch } = setup({
      state: "starting",
      handlers: {
        "engine/status": async () => ok(status),
        "safety/status": async () => ok({ frozen: false }),
      },
    });
    const answers = await Promise.all(
      [
        call("safety/status", {}),
        call("engine/status", {}),
        call("push/subscribe", { topics: { engine: {} } }),
      ].map(async (frame) => framesOf(dispatch(frame, session(cli)))),
    );
    expect(answers.map((frames) => frames[0]?.t)).toStrictEqual(["fail", "reply", "reply"]);
    expect(answers[0]).toMatchObject([{ error: { code: "engine.starting", retryable: true } }]);
  });

  it("decodes args and encodes the result with the operation's schemas", async () => {
    const seen: bigint[] = [];
    const { dispatch } = setup({
      handlers: {
        "usage/record": async ({ args }) => {
          seen.push(args.usdMicros);
          return ok({ budgetLeftMicros: 2n ** 64n });
        },
      },
    });
    const args = {
      agent,
      turn,
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 0,
      usdMicros: "1500",
    };
    const frames = await framesOf(dispatch(call("usage/record", args, "k"), session(["agent"])));
    expect(seen).toStrictEqual([1500n]);
    expect(frames).toStrictEqual([
      { t: "reply", id: "c1", result: { budgetLeftMicros: "18446744073709551616" } },
    ]);
  });

  it("keeps the code and details of a BinferenceError with a protocol code", async () => {
    const thrown = new BinferenceError({
      code: "chain.rpc_down",
      message: "RPC down.",
      retryable: true,
      details: { tries: 3 },
    });
    const { dispatch } = setup({
      handlers: { "safety/status": async () => Promise.reject(thrown) },
    });
    await expect(
      framesOf(dispatch(call("safety/status", {}), session(cli))),
    ).resolves.toStrictEqual([
      {
        t: "fail",
        id: "c1",
        error: {
          code: "chain.rpc_down",
          message: "RPC down.",
          retryable: true,
          details: { tries: 3 },
        },
      },
    ]);
  });

  it.each([
    ["a thrown error", async () => Promise.reject(new Error("boom")), "unexpected"],
    ["a result that breaks its schema", async () => ok({ frozen: "no" }), "server.bad_result"],
  ] as const)(
    "answers %s with internal error and logs it by ref",
    async (_name, handler, logged) => {
      const { dispatch, logger } = setup({ handlers: { "safety/status": handler as never } });
      const [frame] = await framesOf(dispatch(call("safety/status", {}), session(cli)));
      const ref = failRef(frame);
      expect(frame).toMatchObject({
        t: "fail",
        error: { code: "internal.error", retryable: false },
      });
      expect(logger.records()).toContainEqual({
        level: "error",
        subsystem: "server",
        event: "server.call_failed",
        fields: { traceId: ref, errorCode: logged },
      });
    },
  );

  it("answers engine describe with every operation", async () => {
    const { dispatch } = setup();
    const [frame] = await framesOf(dispatch(call("engine/describe", {}), session(["read"])));
    const described = JSON.stringify(replyResult(frame));
    expect(operationNames.every((name) => described.includes(`"name":"${name}"`))).toBe(true);
  });

  it("fails a call as stopping when the server stops during it", async () => {
    const { dispatch, stop } = setup({
      handlers: {
        "safety/status": async ({ signal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          ),
      },
    });
    const step = dispatch(call("safety/status", {}), session(cli));
    stop.abort();
    await expect(framesOf(step)).resolves.toMatchObject([
      { t: "fail", error: { code: "engine.stopping", retryable: true } },
    ]);
  });
});
