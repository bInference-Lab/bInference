import { type Clock, idSchema } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";
import { sha256Hex } from "@binference/engine";
import { protocolIdSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { challengeNonce, openFrame, openRawSocket } from "./raw-socket.js";
import { proofSignature, startTestServer, type TestServer } from "./test-server.js";

const device = protocolIdSchema("consoleDevice").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");

// A sleep that ends only when its signal aborts.
async function stalled(signal: AbortSignal): Promise<void> {
  await new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

// A clock whose sleeps of a minute or more never end, as a timer stalls while the machine sleeps.
function heldBack(clock: ManualClock): Clock {
  return {
    now: () => clock.now(),
    sleep: async (delayMs, signal) =>
      delayMs < 60_000 ? clock.sleep(delayMs, signal) : stalled(signal),
  };
}

describe("the sign-in handshake", () => {
  let test: TestServer | undefined;

  async function start(): Promise<TestServer> {
    test = await startTestServer();
    return test;
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  it("ends a connection whose first frame is not open", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.send({ t: "call", id: "1", op: "engine/status", args: {} });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.not_open" });
    await expect(raw.closed).resolves.toBe(1008);
  });

  it("ends a connection that sends nothing within the sign-in time", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    await server.clock.advance(9_999);
    raw.send(openFrame({ token: server.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    const late = await openRawSocket(server.ipcUrl);
    await server.clock.advance(10_000);
    await expect(late.next()).resolves.toMatchObject({ t: "bye", code: "protocol.not_open" });
    raw.close();
  });

  it("ends a device sign-in whose proof does not arrive in time as expired", async () => {
    const server = await start();
    const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
    raw.send(openFrame({ device: server.device.id }));
    await expect(raw.next()).resolves.toMatchObject({ t: "challenge" });
    await server.clock.advance(10_000);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
  });

  it("refuses a device proof signed for another origin", async () => {
    const server = await start();
    const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
    raw.send(openFrame({ device: server.device.id }));
    const nonce = challengeNonce(await raw.next());
    const signature = proofSignature(server.device, { nonce, origin: "http://localhost:1" });
    raw.send({ t: "prove", signature });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.invalid" });
  });

  it("accepts the loopback origin by name as well as by address", async () => {
    const server = await start();
    const origin = `http://localhost:${String(server.httpPort)}`;
    const raw = await openRawSocket(server.wsUrl, { origin });
    raw.send(openFrame({ device: server.device.id }));
    const nonce = challengeNonce(await raw.next());
    raw.send({ t: "prove", signature: proofSignature(server.device, { nonce, origin }) });
    await expect(raw.next()).resolves.toMatchObject({ t: "ready", connection: /^con_/ });
    raw.close();
  });

  it.each([
    [
      "an open of a protocol version it does not serve",
      { ...openFrame({ token: "x" }), v: 2 },
      "protocol.version",
    ],
    ["text that is not a frame", "not json", "protocol.bad_frame"],
    ["an unknown token", openFrame({ token: `bnt_${"9".repeat(43)}` }), "auth.invalid"],
    ["a device over IPC", openFrame({ device }), "auth.invalid"],
    [
      "a Telegram launch, which this server cannot check",
      openFrame({ telegram: { initData: "a=1" } }),
      "auth.invalid",
    ],
  ] as const)("refuses %s", async (_name, frame, code) => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(frame);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code });
  });

  it("refuses a revoked token", async () => {
    const server = await start();
    const signal = AbortSignal.timeout(1_000);
    await server.access.revokeToken({ id: server.cliToken.id, atMs: 5 }, { signal });
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(openFrame({ token: server.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.revoked" });
  });

  it("ends a connection signed in with a token when the token expires", async () => {
    const server = await start();
    const secret = `bnt_${"8".repeat(43)}`;
    const expiresAtMs = server.clock.now() + 60_000;
    const record = {
      id: idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000088"),
      label: "mcp-claude-code-session",
      kind: "mcp",
      scopes: ["read", "propose"],
      secretHash: sha256Hex(secret),
      createdAtMs: 0,
      expiresAtMs,
    } as const;
    await server.access.addToken(record, { signal: AbortSignal.timeout(1_000) });
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(openFrame({ token: secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    await server.clock.advance(60_000);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
    const again = await openRawSocket(server.ipcUrl);
    again.send(openFrame({ token: secret }));
    await expect(again.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
  });

  it("ends a connection whose token expired at its next call, when no timer fired", async () => {
    // A timer stops while the machine sleeps; the expiry's timer here never fires.
    const server = await startTestServer({ wrapClock: heldBack });
    test = server;
    const secret = `bnt_${"9".repeat(43)}`;
    const record = {
      id: idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000089"),
      label: "mcp-claude-code-session",
      kind: "mcp",
      scopes: ["read", "propose"],
      secretHash: sha256Hex(secret),
      createdAtMs: 0,
      expiresAtMs: server.clock.now() + 60_000,
    } as const;
    await server.access.addToken(record, { signal: AbortSignal.timeout(1_000) });
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(openFrame({ token: secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    await server.clock.advance(60_000);
    raw.send({ t: "call", id: "s", op: "engine/status", args: {} });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
  });

  it("refuses a binary frame", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.sendBinary(Uint8Array.from([1, 2, 3]));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.bad_frame" });
  });

  it("refuses a frame before ready that is over the sign-in size", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.send({ ...openFrame({ token: server.cliToken.secret }), pad: "x".repeat(70_000) });
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.too_large" });
    await expect(raw.closed).resolves.toBe(1009);
  });

  it("ends a connection that sends a frame other than a call after ready", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(openFrame({ token: server.cliToken.secret }));
    await raw.next();
    raw.send(openFrame({ token: server.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.bad_frame" });
  });
});
