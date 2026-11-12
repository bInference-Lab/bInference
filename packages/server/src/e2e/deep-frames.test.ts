import { idSchema, maxJsonDepth, ok } from "@binference/core";
import { sha256Hex } from "@binference/engine";
import type { EngineState } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationHandlers } from "../operation-handlers.js";
import { challengeOf, openFrame, openRawSocket, type RawSocket } from "./raw-socket.js";
import { proofSignature, startTestServer, type TestServer } from "./test-server.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const plugin = "plg_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const runtimeSecret = `bnt_${"9".repeat(43)}`;
// A frame that took the engine down before decision 0417: about 4 KiB, nested 2,000 deep.
const deep = 2_000;

// Brackets nested `depth` deep: `[[...]]`.
const nested = (depth: number): string => `${"[".repeat(depth)}${"]".repeat(depth)}`;

// A `plugin/call` frame whose input nests `depth` deep: the frame itself nests two more.
function pluginCall(id: string, depth: number): string {
  const args = `{"agent":"${agent}","plugin":"${plugin}","tool":"x","input":${nested(depth)}}`;
  return `{"t":"call","id":"${id}","op":"plugin/call","args":${args}}`;
}

const handlers: OperationHandlers = { "plugin/call": async () => ok({ output: null }) };

// The engine's state, which throws once when asked after `throwNext`: a fault while a frame is read.
function stateThatThrows(): { readonly state: () => EngineState; readonly throwNext: () => void } {
  const throws = { next: false };
  return {
    state: () => {
      if (throws.next) {
        throws.next = false;
        throw new Error("The engine's state could not be read.");
      }
      return "ready";
    },
    throwNext: () => {
      throws.next = true;
    },
  };
}

describe("frames nested past the bound", () => {
  let test: TestServer | undefined;
  const sockets: RawSocket[] = [];

  async function started(
    options: { readonly state?: () => EngineState } = {},
  ): Promise<TestServer> {
    test = await startTestServer({ handlers, ...options });
    const record = {
      id: idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000009"),
      label: "runtime",
      kind: "runtime",
      scopes: ["agent"],
      secretHash: sha256Hex(runtimeSecret),
      createdAtMs: 0,
    } as const;
    await test.access.addToken(record, { signal: AbortSignal.timeout(1_000) });
    return test;
  }

  // A raw socket signed in over IPC with a token, ready for calls.
  async function overIpc(server: TestServer, secret: string): Promise<RawSocket> {
    const raw = await openRawSocket(server.ipcUrl);
    sockets.push(raw);
    raw.send(openFrame({ token: secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    return raw;
  }

  // A raw socket signed in over WS as the paired console device.
  async function overWs(server: TestServer): Promise<RawSocket> {
    const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
    sockets.push(raw);
    raw.send(openFrame({ device: server.device.id }));
    const challenge = challengeOf(await raw.next());
    raw.send({
      t: "prove",
      signature: proofSignature(server.device, { ...challenge, origin: server.origin }),
    });
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    return raw;
  }

  afterEach(async () => {
    sockets.splice(0).forEach((raw) => raw.close());
    await test?.close();
    test = undefined;
  });

  it("refuses a deep call over IPC, answers the connection's next call, and serves a second one", async () => {
    const server = await started();
    const raw = await overIpc(server, runtimeSecret);
    raw.send(pluginCall("c1", deep));
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "c1",
      error: { code: "protocol.too_large", message: "The frame nests too deep." },
    });
    raw.send(pluginCall("c2", 1));
    await expect(raw.next()).resolves.toStrictEqual({
      t: "reply",
      id: "c2",
      result: { output: null },
    });
    await overIpc(server, server.cliToken.secret);
  });

  it("refuses a deep call over WS and serves a second connection", async () => {
    const server = await started();
    const raw = await overWs(server);
    raw.send(`{"t":"call","id":"c1","op":"safety/status","args":{"x":${nested(deep)}}}`);
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "c1",
      error: { code: "protocol.too_large" },
    });
    await overWs(server);
  });

  it("answers a frame nested exactly at the bound and refuses one level more", async () => {
    const server = await started();
    const raw = await overIpc(server, runtimeSecret);
    raw.send(pluginCall("at", maxJsonDepth - 2));
    await expect(raw.next()).resolves.toMatchObject({ t: "reply", id: "at" });
    raw.send(pluginCall("past", maxJsonDepth - 1));
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "past",
      error: { code: "protocol.too_large" },
    });
  });

  it("ends only the connection whose frame threw while it was read, logs it, and serves the next", async () => {
    const { state, throwNext } = stateThatThrows();
    const server = await started({ state });
    const raw = await overIpc(server, server.cliToken.secret);
    throwNext();
    raw.send({ t: "call", id: "c1", op: "safety/status", args: {} });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.bad_frame" });
    const failed = server.logger.records().filter(({ event }) => event === "server.frame_failed");
    expect(failed.map(({ fields }) => fields?.errorCode)).toStrictEqual(["unexpected"]);
    await overIpc(server, server.cliToken.secret);
  });
});
