import type { ProtocolClient } from "@binference/client";
import { BinferenceError, ok } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import { createMemoryIdempotencyStore } from "@binference/engine/testing";
import { type PushFrame, protocolIdSchema } from "@binference/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProtocolServer } from "../create-protocol-server.js";
import type { OperationHandler, OperationHandlers } from "../operation-handlers.js";
import { connectClient, gather, startTestServer, type TestServer } from "./test-server.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");

describe("the protocol server with the real client", () => {
  let test: TestServer | undefined;
  const clients: ProtocolClient[] = [];

  async function start(handlers: OperationHandlers = {}): Promise<TestServer> {
    test = await startTestServer({ handlers });
    return test;
  }

  function client(server: TestServer, route: Parameters<typeof connectClient>[1]): ProtocolClient {
    const connected = connectClient(server, route);
    clients.push(connected);
    return connected;
  }

  afterEach(async () => {
    clients.splice(0).forEach((connected) => connected.close());
    await test?.close();
    test = undefined;
  });

  it("signs a client token in over IPC and answers a call within its scopes", async () => {
    const server = await start({ "safety/status": async () => ok({ frozen: false }) });
    const cli = client(server, {
      url: server.ipcUrl,
      credential: { token: server.cliToken.secret },
    });
    const ready = await cli.connect(AbortSignal.timeout(5_000));
    expect(ready.scopes).toStrictEqual(["read", "propose", "chat", "confirm", "loosen", "admin"]);
    expect(ready.engine).toStrictEqual({ version: "2026.10.0", protocol: 1, state: "ready" });
    await expect(
      cli.call("safety/status", {}, { signal: AbortSignal.timeout(5_000) }),
    ).resolves.toStrictEqual({
      frozen: false,
    });
  });

  it("fails a call outside the caller's scopes and never runs it", async () => {
    const freeze = vi.fn<OperationHandler<"safety/freeze">>(async () => ok({ frozenAt: 1 }));
    const server = await start({ "safety/freeze": freeze });
    const mcp = client(server, {
      url: server.ipcUrl,
      credential: { token: server.mcpToken.secret },
      kind: "mcp",
    });
    await mcp.connect(AbortSignal.timeout(5_000));
    await expect(
      mcp.call("safety/freeze", {}, { signal: AbortSignal.timeout(5_000) }),
    ).rejects.toMatchObject({
      code: "auth.scope",
    });
    expect(freeze).not.toHaveBeenCalled();
  });

  it("returns the first result for a repeated write and runs it once", async () => {
    let clock = 0;
    const freeze = vi.fn<OperationHandler<"safety/freeze">>(async () => {
      clock += 1;
      return ok({ frozenAt: clock });
    });
    const server = await start({ "safety/freeze": freeze });
    const cli = client(server, {
      url: server.ipcUrl,
      credential: { token: server.cliToken.secret },
    });
    await cli.connect(AbortSignal.timeout(5_000));
    const options = { signal: AbortSignal.timeout(5_000), key: "key-freeze-1" };
    const first = await cli.call("safety/freeze", {}, options);
    const second = await cli.call("safety/freeze", {}, options);
    expect(second).toStrictEqual(first);
    expect(freeze).toHaveBeenCalledOnce();
    await expect(cli.call("safety/freeze", { agent }, options)).rejects.toMatchObject({
      code: "protocol.key_reused",
    });
  });

  it("pushes a topic to its subscriber in seq order", async () => {
    const server = await start();
    const cli = client(server, {
      url: server.ipcUrl,
      credential: { token: server.cliToken.secret },
    });
    await cli.connect(AbortSignal.timeout(5_000));
    const pushes = gather<PushFrame>(2);
    const loaded = gather<true>(1);
    cli.subscribe("intent", {
      onPush: pushes.add,
      refetch: async () => loaded.add(true),
    });
    await loaded.all;
    server.server.publish({ topic: "intent", kind: "intent/changed", data: { n: 1 } });
    server.server.publish({ topic: "intent", kind: "intent/changed", data: { n: 2 } });
    const received = await pushes.all;
    expect(received.map((push) => [push.seq, push.data])).toStrictEqual([
      [1, { n: 1 }],
      [2, { n: 2 }],
    ]);
  });

  it("signs a console device in over WS by its answer to a challenge", async () => {
    const server = await start();
    const console = client(server, {
      url: server.wsUrl,
      credential: { device: server.device.id },
      kind: "console",
      origin: server.origin,
      device: server.device,
    });
    const ready = await console.connect(AbortSignal.timeout(5_000));
    expect(ready.scopes).toContain("confirm");
    expect(ready.scopes).not.toContain("agent");
  });

  it("refuses a client token over WS as local only", async () => {
    const server = await start();
    const route = { url: server.wsUrl, credential: { token: server.cliToken.secret } };
    const cli = client(server, { ...route, origin: server.origin });
    await expect(cli.connect(AbortSignal.timeout(5_000))).rejects.toMatchObject({
      code: "auth.local_only",
    });
  });

  it("refuses a WS connection from an origin it does not allow", async () => {
    const server = await start();
    const route = { url: server.wsUrl, credential: { device: server.device.id } };
    const page = client(server, { ...route, origin: "http://evil.example" });
    await expect(page.connect(AbortSignal.timeout(5_000))).rejects.toMatchObject({
      code: "auth.origin",
    });
  });

  it("never writes a client token to the log", async () => {
    const server = await start();
    const cli = client(server, {
      url: server.ipcUrl,
      credential: { token: server.cliToken.secret },
    });
    await cli.connect(AbortSignal.timeout(5_000));
    const logged = JSON.stringify(server.logger.records());
    expect(logged).toContain("server.ready");
    expect(logged).not.toContain("bnt_");
    expect(logged).not.toContain("[redacted]");
  });
});

describe("binding the HTTP listener", () => {
  it("refuses to start beyond loopback without auth, before anything binds", async () => {
    const server = createProtocolServer({
      http: { host: "0.0.0.0", port: 0 },
      idempotency: createMemoryIdempotencyStore(),
      handlers: {},
      engine: {
        version: "1",
        state: () => "ready",
        owner: () => ({ locale: "en", timezone: "UTC" }),
      },
      clock: createManualClock(),
      random: createSeededRandom(1),
      logger: createMemoryLogger({ subsystem: "server" }),
    });
    const started = server.start(AbortSignal.timeout(5_000));
    await expect(started).rejects.toBeInstanceOf(BinferenceError);
    await expect(started).rejects.toMatchObject({ code: "server.unsafe_bind" });
    await server.close();
  });
});
