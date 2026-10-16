import { ok } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Caller } from "../operation-handlers.js";
import type { ServerLimits } from "../server-limits.js";
import { botToken, fieldsOf, initDataOf, miniOpen, ownerId, ticketFor } from "./mini-app-launch.js";
import { openRawSocket, type RawSocket } from "./raw-socket.js";
import { startTestServer, type TestServer } from "./test-server.js";

const tailnetOrigin = "https://engine.tail1234.ts.net";

// Opens a socket from the Mini App's origin and sends its `open`, with a new launch ticket.
async function openAs(server: TestServer, initData: string): Promise<RawSocket> {
  const ticket = await ticketFor(server);
  const raw = await openRawSocket(server.wsUrl, { origin: tailnetOrigin });
  raw.send(miniOpen(initData, ticket));
  return raw;
}

describe("a Telegram Mini App signing in", () => {
  let test: TestServer | undefined;
  const callers: Caller[] = [];

  async function start(limits: Partial<ServerLimits> = {}): Promise<TestServer> {
    test = await startTestServer({
      limits,
      miniApp: { botToken, ownerId: async () => ownerId },
      extraOrigins: [tailnetOrigin],
      handlers: {
        "safety/unfreeze": async ({ caller }) => {
          callers.push(caller);
          return ok({});
        },
      },
    });
    return test;
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
    callers.length = 0;
  });

  it("signs the owner's launch in with the Mini App's scopes and serves its calls", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    const raw = await openAs(server, initData);
    await expect(raw.next()).resolves.toMatchObject({
      t: "ready",
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    raw.send({ t: "call", id: "u", op: "safety/unfreeze", args: {}, key: "k1" });
    await expect(raw.next()).resolves.toStrictEqual({ t: "reply", id: "u", result: {} });
    raw.send({ t: "call", id: "p", op: "identity/register", args: { agent: "agt_x" }, key: "k2" });
    await expect(raw.next()).resolves.toMatchObject({
      t: "fail",
      id: "p",
      error: { code: "auth.scope" },
    });
    expect(
      callers.map(({ credential, client, transport }) => [credential, client.kind, transport]),
    ).toStrictEqual([["tg:279058397", "mini", "ws"]]);
    raw.close();
  });

  it("refuses the same launch on a second connection", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    const first = await openAs(server, initData);
    await expect(first.next()).resolves.toMatchObject({ t: "ready" });
    const again = await openAs(server, initData);
    await expect(again.next()).resolves.toMatchObject({ t: "bye", code: "auth.invalid" });
    await expect(again.closed).resolves.toBe(1008);
    first.close();
  });

  it("refuses a launch older than 5 minutes as expired", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    await server.clock.advance(5 * 60_000 + 1_000);
    const raw = await openAs(server, initData);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
  });

  it("refuses a launch Telegram signed for another user", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId + 1, atMs: server.clock.now() }));
    const raw = await openAs(server, initData);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.invalid" });
  });

  it("refuses a launch whose user someone changed to the owner's", async () => {
    const server = await start();
    const fields = fieldsOf({ userId: ownerId + 1, atMs: server.clock.now() });
    const signed = new URLSearchParams(initDataOf(fields));
    signed.set("user", JSON.stringify({ id: ownerId, first_name: "Ada", language_code: "en" }));
    const raw = await openAs(server, signed.toString());
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.invalid" });
  });

  it("ends the Mini App's connection 12 hours after it signed in", async () => {
    // Pings a day apart, so the 12 hours pass in one step.
    const day = 24 * 60 * 60_000;
    const server = await start({ pingIntervalMs: day, pongTimeoutMs: day });
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    const raw = await openAs(server, initData);
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    await server.clock.advance(12 * 60 * 60_000);
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.expired" });
  });

  it("refuses the owner's launch without a ticket from /console", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    const raw = await openRawSocket(server.wsUrl, { origin: tailnetOrigin });
    raw.send(miniOpen(initData));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.invalid" });
  });

  it("refuses a launch from an origin the engine does not allow", async () => {
    const server = await start();
    const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
    const raw = await openRawSocket(server.wsUrl, { origin: "https://elsewhere.example" });
    raw.send(miniOpen(initData, await ticketFor(server)));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.origin" });
    const owner = await openAs(server, initData);
    await expect(owner.next()).resolves.toMatchObject({ t: "ready" });
    owner.close();
  });
});
