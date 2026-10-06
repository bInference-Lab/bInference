import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import {
  credentialSchema,
  type EngineFrame,
  type OpenFrame,
  protocolVersion,
  readyFrameSchema,
} from "@binference/protocol";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createFakeEngine } from "./fake-engine.js";
import { type ConnectionOptions, type DeviceProver, openConnection } from "./open-connection.js";
import type { SocketFactory } from "./protocol-socket.js";

const open: OpenFrame = {
  t: "open",
  v: protocolVersion,
  client: { kind: "console", version: "0.1.0" },
  auth: credentialSchema.parse({ device: "dev_0190f1c2-3a4b-7c5d-8e6f-0123456789ab" }),
};
const ready = readyFrameSchema.parse({
  t: "ready",
  v: protocolVersion,
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  scopes: ["read", "confirm"],
  engine: { version: "2026.10.0", protocol: protocolVersion, state: "ready" },
  owner: { locale: "zh", timezone: "Asia/Shanghai" },
});
const challenge = { t: "challenge", nonce: "n".repeat(43) } as const;
const signal = new AbortController().signal;
// Never called: it proves at compile time that the standard WebSocket fits the socket shape.
const openGlobalSocket: SocketFactory = () => new WebSocket("ws://127.0.0.1:7456/ws");

function setup(proveDevice?: DeviceProver) {
  const engine = createFakeEngine();
  const clock = createManualClock(1_000);
  const logger = createMemoryLogger({ subsystem: "client" });
  const frames: EngineFrame[] = [];
  const options: ConnectionOptions = {
    openSocket: engine.openSocket,
    open,
    ...(proveDevice === undefined ? {} : { proveDevice }),
    clock,
    logger,
    timeoutMs: 10_000,
    onFrame: (frame) => frames.push(frame),
  };
  return { engine, clock, logger, frames, connection: openConnection(options, signal) };
}

describe("openConnection", () => {
  it("sends open once the socket opens and resolves at ready", async () => {
    const { engine, connection } = setup();
    const socket = engine.latest();
    expect(socket.sent()).toStrictEqual([]);
    socket.accept();
    socket.deliver(ready);
    await expect(connection).resolves.toMatchObject({ ready });
    expect(socket.sent()).toStrictEqual([open]);
  });

  it("answers a challenge with the device prover's signature", async () => {
    const signature = "s".repeat(86);
    const proveDevice = vi.fn<DeviceProver>(async () => signature);
    const { engine, clock, connection } = setup(proveDevice);
    const socket = engine.latest();
    socket.accept();
    socket.deliver(challenge);
    await clock.advance(0);
    socket.deliver(ready);
    await expect(connection).resolves.toMatchObject({ ready });
    expect(proveDevice).toHaveBeenCalledWith(challenge.nonce, expect.any(AbortSignal));
    expect(socket.sent()).toStrictEqual([open, { t: "prove", signature }]);
  });

  it.each([
    ["a challenge it cannot prove", challenge, "client.cannot_prove"],
    ["a ready frame of a version it does not speak", { ...ready, v: 2 }, "protocol.version"],
  ] as const)("fails for good at %s and closes the socket", async (_case, frame, code) => {
    const { engine, connection } = setup();
    const socket = engine.latest();
    socket.accept();
    socket.deliver(frame);
    await expect(connection).rejects.toMatchObject({ code, retryable: false });
    expect(socket.readyState).toBe(3);
  });

  it("fails for good with the code of a bye before ready", async () => {
    const { engine, connection } = setup();
    const socket = engine.latest();
    socket.accept();
    socket.deliver({ t: "bye", code: "auth.invalid", message: "Unknown device." });
    socket.drop(1008);
    await expect(connection).rejects.toMatchObject({ code: "auth.invalid", retryable: false });
  });

  it("fails with a retryable disconnect when the socket drops before ready", async () => {
    const { engine, connection } = setup();
    engine.latest().drop();
    await expect(connection).rejects.toMatchObject({
      code: "client.disconnected",
      retryable: true,
      details: { closeCode: 1006 },
    });
  });

  it("gives up a handshake that never reaches ready and closes its socket", async () => {
    const { engine, clock, connection } = setup();
    engine.latest().accept();
    await clock.advance(10_000);
    await expect(connection).rejects.toMatchObject({ code: "core.timeout", retryable: true });
    expect(engine.latest().readyState).toBe(3);
  });

  it("refuses to open a socket for an attempt already aborted", async () => {
    const engine = createFakeEngine();
    const options = { openSocket: engine.openSocket } as ConnectionOptions;
    await expect(openConnection(options, AbortSignal.abort("stop"))).rejects.toBe("stop");
    expect(engine.sockets()).toStrictEqual([]);
  });

  it("hands every frame after ready to its handler and resolves closed with the bye reason", async () => {
    const { engine, frames, connection } = setup();
    const socket = engine.latest();
    socket.accept();
    socket.deliver(ready);
    const opened = await connection;
    const reply = { t: "reply", id: "1", result: { state: "settled" } } as const;
    socket.deliver(reply);
    socket.deliver({ t: "bye", code: "engine.stopping", message: "Restarting." });
    socket.drop(1001);
    expect(frames).toStrictEqual([reply]);
    await expect(opened.closed).resolves.toMatchObject({
      code: "engine.stopping",
      retryable: true,
    });
  });

  it("sends frames while open and closes on request", async () => {
    const { engine, connection } = setup();
    const socket = engine.latest();
    socket.accept();
    socket.deliver(ready);
    const opened = await connection;
    const call = { t: "call", id: "1", op: "intent/get", args: { intent: "int_1" } } as const;
    opened.send(call);
    opened.close();
    opened.send({ ...call, id: "2" });
    expect(socket.sent()).toStrictEqual([open, call]);
    await expect(opened.closed).resolves.toMatchObject({
      code: "client.disconnected",
      details: { closeCode: 1000 },
    });
  });

  it("logs and skips a message that is not a protocol frame", async () => {
    const { engine, logger, connection } = setup();
    const socket = engine.latest();
    socket.accept();
    socket.deliverText("not json");
    socket.deliver(ready);
    await expect(connection).resolves.toMatchObject({ ready });
    expect(logger.records().map((record) => record.event)).toStrictEqual(["client.bad_frame"]);
  });

  it("takes the global WebSocket as its socket", () => {
    expectTypeOf(openGlobalSocket).returns.toHaveProperty("readyState");
  });
});
