import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { createSeededRandom } from "@binference/core/testing";
import { consolePairLifetimeMs, issueConsolePairCode } from "@binference/engine/access";
import { deviceProofText, protocolIdSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { maxPairBodyBytes } from "../pair-route.js";
import { type LocalAnswer, requestLocal } from "./local-http.js";
import { challengeNonce, openFrame, openRawSocket, type RawSocket } from "./raw-socket.js";
import { startTestServer, type TestServer } from "./test-server.js";

const live = { signal: AbortSignal.timeout(5_000) };

interface Browser {
  readonly privateKey: KeyObject;
  readonly publicKey: string;
}

function browserKey(): Browser {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

async function issueCode(server: TestServer): Promise<string> {
  const random = createSeededRandom(server.clock.now() % 1_000);
  const issued = await issueConsolePairCode({ ...server, random }, live);
  return issued.code;
}

async function postPair(server: TestServer, body: object | string, origin = server.origin) {
  return requestLocal(server.httpPort, {
    path: "/pair",
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function pairBody(code: string, browser: Browser) {
  return { code, publicKey: browser.publicKey, alg: "ed25519", label: "Laptop" };
}

function errorOf(answer: LocalAnswer) {
  return { status: answer.status, body: JSON.parse(answer.body) as object };
}

async function signIn(server: TestServer, device: string, browser: Browser): Promise<RawSocket> {
  const { origin } = server;
  const raw = await openRawSocket(server.wsUrl, { origin });
  raw.send(openFrame({ device: protocolIdSchema("consoleDevice").parse(device) }));
  const nonce = challengeNonce(await raw.next());
  const text = Buffer.from(deviceProofText({ nonce, origin }));
  raw.send({ t: "prove", signature: sign(null, text, browser.privateKey).toString("base64url") });
  return raw;
}

describe("pairing a console device", () => {
  let test: TestServer | undefined;

  async function start(): Promise<TestServer> {
    test = await startTestServer();
    return test;
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  it("pairs a browser with a fresh link, which then signs in with every console scope", async () => {
    const server = await start();
    const browser = browserKey();
    const answer = await postPair(server, pairBody(await issueCode(server), browser));
    expect(answer.status).toBe(201);
    const { deviceId } = JSON.parse(answer.body) as { readonly deviceId: string };
    expect(deviceId).toMatch(/^dev_/);
    expect(server.pairingPushes).toMatchObject([
      { kind: "notice/new", data: { key: "notice.newDevice", values: { label: "Laptop" } } },
    ]);
    const raw = await signIn(server, deviceId, browser);
    await expect(raw.next()).resolves.toMatchObject({
      t: "ready",
      scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
    });
    raw.close();
  });

  it("refuses a link used once already", async () => {
    const server = await start();
    const code = await issueCode(server);
    await postPair(server, pairBody(code, browserKey()));
    expect(errorOf(await postPair(server, pairBody(code, browserKey())))).toStrictEqual({
      status: 401,
      body: { error: { code: "auth.invalid", message: "The pairing code is unknown or used." } },
    });
  });

  it("refuses a link past its 10 minutes", async () => {
    const server = await start();
    const code = await issueCode(server);
    await server.clock.advance(consolePairLifetimeMs);
    expect(errorOf(await postPair(server, pairBody(code, browserKey())))).toMatchObject({
      status: 401,
      body: { error: { code: "auth.expired" } },
    });
  });

  it("refuses another origin, and a malformed body, and leaves the code working", async () => {
    const server = await start();
    const code = await issueCode(server);
    const body = pairBody(code, browserKey());
    const other = await postPair(server, body, "https://evil.example");
    expect(errorOf(other)).toMatchObject({ status: 403, body: { error: { code: "auth.origin" } } });
    const noKey = await postPair(server, { ...body, publicKey: "bm90LWEta2V5" });
    expect(errorOf(noKey)).toMatchObject({
      status: 400,
      body: { error: { code: "protocol.bad_args" } },
    });
    const extra = await postPair(server, { ...body, scopes: ["admin"] });
    expect(extra.status).toBe(400);
    expect((await postPair(server, "not json")).status).toBe(400);
    expect((await postPair(server, body)).status).toBe(201);
  });

  it("refuses a body over 4 KiB and a method other than POST", async () => {
    const server = await start();
    const large = await postPair(server, { pad: "x".repeat(maxPairBodyBytes) });
    expect(errorOf(large)).toMatchObject({
      status: 413,
      body: { error: { code: "protocol.too_large" } },
    });
    const read = await requestLocal(server.httpPort, { path: "/pair" });
    expect(read.status).toBe(405);
  });

  it("keeps pairing and health off the public address, and opens sockets through it", async () => {
    test = await startTestServer({ publicOrigin: "https://owner.example.ts.net" });
    const server = test;
    const browser = browserKey();
    const code = await issueCode(server);
    const body = JSON.stringify(pairBody(code, browser));
    const json = { "content-type": "application/json" };
    const published = [
      {
        path: "/pair",
        method: "POST",
        headers: { ...json, origin: "https://owner.example.ts.net" },
      },
      {
        path: "/pair",
        method: "POST",
        headers: { ...json, host: "owner.example.ts.net", origin: server.origin },
      },
      { path: "/health", headers: { host: "owner.example.ts.net" } },
      { path: "/health", headers: { "x-forwarded-host": "owner.example.ts.net" } },
    ];
    const answers = await Promise.all(
      published.map(async (sent) => requestLocal(server.httpPort, { ...sent, body })),
    );
    expect(answers.map((answer) => answer.status)).toStrictEqual([404, 404, 404, 404]);
    expect((await requestLocal(server.httpPort, { path: "/health" })).status).toBe(200);
    expect((await postPair(server, pairBody(code, browser))).status).toBe(201);
    const raw = await openRawSocket(server.wsUrl, { origin: "https://owner.example.ts.net" });
    raw.send(openFrame({ token: server.cliToken.secret }));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.local_only" });
  });

  it("serves no pairing on the IPC listener", async () => {
    const server = await start();
    const port = Number(new URL(server.ipcUrl).port);
    const answer = await requestLocal(port, { path: "/pair", method: "POST", body: "{}" });
    expect(answer.status).toBe(404);
  });

  it("ends a revoked device's connection at once, and refuses its next sign-in", async () => {
    const server = await start();
    const browser = browserKey();
    const answer = await postPair(server, pairBody(await issueCode(server), browser));
    const { deviceId } = JSON.parse(answer.body) as { readonly deviceId: string };
    const raw = await signIn(server, deviceId, browser);
    await raw.next();
    const id = protocolIdSchema("consoleDevice").parse(deviceId);
    await server.access.revokeDevice({ id, atMs: server.clock.now() }, live);
    server.server.endSessions(deviceId, "auth.revoked");
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.revoked" });
    const again = await openRawSocket(server.wsUrl, { origin: server.origin });
    again.send(openFrame({ device: id }));
    await expect(again.next()).resolves.toMatchObject({ t: "bye", code: "auth.revoked" });
  });
});
