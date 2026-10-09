import { ok, stableJson } from "@binference/core";
import { sha256Hex } from "@binference/engine";
import type { EngineFrame } from "@binference/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationHandler, OperationHandlers } from "../operation-handlers.js";
import type { ServerLimits } from "../server-limits.js";
import { openFrame, openRawSocket, type RawSocket } from "./raw-socket.js";
import { gather, startTestServer, type TestServer } from "./test-server.js";

function stalled(gate: Promise<unknown>): OperationHandler<"safety/status"> {
  return async () => {
    await gate;
    return ok({ frozen: false });
  };
}

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(1_000) });

function idOf(frame: EngineFrame): string {
  return "id" in frame ? frame.id : frame.t;
}

describe("calls over a signed-in connection", () => {
  let test: TestServer | undefined;

  async function signedIn(
    handlers: OperationHandlers,
    limits: Partial<ServerLimits> = {},
  ): Promise<{ readonly server: TestServer; readonly raw: RawSocket }> {
    test = await startTestServer({ handlers, limits });
    const raw = await openRawSocket(test.ipcUrl);
    raw.send(openFrame({ token: test.cliToken.secret }));
    await raw.next();
    return { server: test, raw };
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  const status = { t: "call", op: "safety/status", args: {} } as const;

  it("answers a call over the frame size with a fail and keeps the connection", async () => {
    const handlers = { "safety/status": async () => ok({ frozen: true }) };
    const { raw } = await signedIn(handlers, { maxFrameBytes: 512 });
    raw.send({ ...status, id: "big", args: { pad: "x".repeat(600) } });
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "big",
      error: { code: "protocol.too_large" },
    });
    raw.send({ ...status, id: "small" });
    await expect(raw.next()).resolves.toStrictEqual({
      t: "reply",
      id: "small",
      result: { frozen: true },
    });
  });

  it("fails a call over the in-flight limit as busy", async () => {
    const gate = gather<true>(1);
    const { raw } = await signedIn({ "safety/status": stalled(gate.all) }, { maxCallsInFlight: 2 });
    ["1", "2", "3"].forEach((id) => raw.send({ ...status, id }));
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "3",
      error: { code: "protocol.busy", retryable: true },
    });
    gate.add(true);
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", id: "1" });
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", id: "2" });
  });

  it("fails a call over the rate as busy until the rate refills", async () => {
    const handlers = { "safety/status": async () => ok({ frozen: false }) };
    const { server, raw } = await signedIn(handlers, { callBurst: 2, callsPerSecond: 1 });
    ["1", "2", "3"].forEach((id) => raw.send({ ...status, id }));
    const answers = [await raw.next(), await raw.next(), await raw.next()];
    const byId = Object.fromEntries(answers.map((answer) => [idOf(answer), answer.t]));
    expect(byId).toStrictEqual({ "1": "reply", "2": "reply", "3": "fail" });
    await server.clock.advance(1_000);
    raw.send({ ...status, id: "4" });
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", id: "4" });
  });

  it("ends the connection when a call reuses the id of a running one", async () => {
    const gate = gather<true>(1);
    const { raw } = await signedIn({ "safety/status": stalled(gate.all) });
    raw.send({ ...status, id: "same" });
    raw.send({ ...status, id: "same" });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.bad_frame" });
    gate.add(true);
  });

  it("fails a call that runs past the call timeout", async () => {
    const started = gather<true>(1);
    const gate = gather<true>(1);
    const slow: OperationHandler<"safety/status"> = async () => {
      started.add(true);
      await gate.all;
      return ok({ frozen: false });
    };
    const { server, raw } = await signedIn({ "safety/status": slow });
    raw.send({ ...status, id: "slow" });
    await started.all;
    await server.clock.advance(30_000);
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "slow",
      error: { code: "engine.timeout", retryable: true },
    });
    gate.add(true);
  });

  it("runs a write sent again on a new connection once, while the first still runs", async () => {
    const gate = gather<true>(1);
    const freeze = vi.fn<OperationHandler<"safety/freeze">>(async () => {
      await gate.all;
      return ok({ frozenAt: 42 });
    });
    const { server, raw } = await signedIn({ "safety/freeze": freeze });
    const write = { t: "call", id: "w", op: "safety/freeze", args: {}, key: "key-1" } as const;
    raw.send(write);
    raw.close();
    await raw.closed;
    const again = await openRawSocket(server.ipcUrl);
    again.send(openFrame({ token: server.cliToken.secret }));
    await again.next();
    again.send(write);
    gate.add(true);
    await expect(again.next()).resolves.toStrictEqual({
      t: "reply",
      id: "w",
      result: { frozenAt: 42 },
    });
    expect(freeze).toHaveBeenCalledOnce();
    again.close();
  });

  it("replays the pushes a client missed when it resumes from a seq", async () => {
    const { server, raw } = await signedIn({});
    [1, 2, 3].forEach((n) => {
      server.server.publish({ topic: "order", kind: "order/changed", data: { n } });
    });
    raw.send({
      t: "call",
      id: "s",
      op: "push/subscribe",
      args: { topics: { order: { fromSeq: 2 } } },
    });
    await expect(raw.next()).resolves.toStrictEqual({
      t: "reply",
      id: "s",
      result: { seqs: { order: 3 } },
    });
    await expect(raw.next()).resolves.toMatchObject({ t: "push", seq: 2, data: { n: 2 } });
    await expect(raw.next()).resolves.toMatchObject({ t: "push", seq: 3, data: { n: 3 } });
    server.server.publish({ topic: "order", kind: "order/filled", data: { n: 4 } });
    await expect(raw.next()).resolves.toMatchObject({ t: "push", seq: 4, kind: "order/filled" });
  });

  it("serves every call while the engine is locked", async () => {
    test = await startTestServer({
      state: () => "locked",
      handlers: { "safety/status": async () => ok({ frozen: false }) },
    });
    const raw = await openRawSocket(test.ipcUrl);
    raw.send(openFrame({ token: test.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready", engine: { state: "locked" } });
    raw.send({ ...status, id: "1" });
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", result: { frozen: false } });
  });

  it("keeps no trace of the unlock passphrase in the idempotency store or the log", async () => {
    const passphrase = "correct horse battery staple";
    const { server, raw } = await signedIn({ "engine/unlock": async () => ok({}) });
    const call = { t: "call", op: "engine/unlock", args: { passphrase }, key: "unlock-1" } as const;
    raw.send({ ...call, id: "u" });
    await expect(raw.next()).resolves.toStrictEqual({ t: "reply", id: "u", result: {} });
    const lookup = {
      credential: server.cliToken.id,
      op: "engine/unlock",
      key: "unlock-1",
      argsHash: sha256Hex(stableJson({})),
    };
    await expect(server.idempotency.recall(lookup, live())).resolves.toStrictEqual({
      kind: "repeat",
      result: {},
    });
    expect(JSON.stringify(server.logger.records())).not.toContain(passphrase);
  });

  it("answers engine starting while the engine starts, except for its status", async () => {
    test = await startTestServer({
      state: () => "starting",
      handlers: {
        "engine/status": async () =>
          ok({
            state: "starting",
            version: "1",
            protocol: 1,
            frozen: false,
            agents: [],
            health: [],
          }),
      },
    });
    const raw = await openRawSocket(test.ipcUrl);
    raw.send(openFrame({ token: test.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready", engine: { state: "starting" } });
    raw.send({ ...status, id: "1" });
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      error: { code: "engine.starting" },
    });
    raw.send({ t: "call", id: "2", op: "engine/status", args: {} });
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", result: { state: "starting" } });
  });
});
