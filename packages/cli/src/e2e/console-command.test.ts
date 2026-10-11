import { Buffer } from "node:buffer";
import type { webcrypto } from "node:crypto";
import { createProtocolClient } from "@binference/client";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { testNowMs } from "@binference/engine/testing";
import { deviceProofText, operations, protocolIdSchema } from "@binference/protocol";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type SkeletonComposition, skeletonCompositions } from "../compose/test-skeleton.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const page = "<!doctype html><title>console</title>";
const tenMinutes = 10 * 60 * 1000;
// The browser's requests go out as the engine's own outbound requests do, over a real socket.
const http = createSystemHttp({ version: "test" });

afterAll(async () => http.close());

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

function selfHosted(): SkeletonComposition {
  const found = skeletonCompositions.find((item) => item.name === "self-hosted");
  if (found === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  return found;
}

interface Served {
  readonly machine: TestMachine;
  readonly skeleton: ServedSkeleton;
}

// The engine of a machine, with its HTTP listener on a free port and a one-page console.
async function serveConsole(): Promise<Served> {
  const machine = await machines.create(testNowMs);
  const consoleFiles = new Map([["index.html", new TextEncoder().encode(page)]]);
  const browser = { http: { host: "127.0.0.1", port: 0 }, consoleFiles };
  const skeleton = await serveSkeleton(machine, selfHosted(), { browser });
  served.push(skeleton);
  await skeleton.composed.server.start(AbortSignal.timeout(5_000));
  return { machine, skeleton };
}

async function consoleLink(machine: TestMachine): Promise<URL> {
  const outcome = await runOn(machine, ["console", "--json"]);
  expect(outcome.code).toBe(0);
  const { link } = JSON.parse(outcome.stdout) as { readonly link: string };
  return new URL(link);
}

/** A browser's device key, made as the console makes it: WebCrypto, never extractable. */
interface BrowserKey {
  readonly privateKey: webcrypto.CryptoKey;
  readonly publicKey: string;
}

async function browserKey(): Promise<BrowserKey> {
  const algorithm: webcrypto.AlgorithmIdentifier = { name: "Ed25519" };
  const keys = await crypto.subtle.generateKey(algorithm, false, ["sign", "verify"]);
  if (!("privateKey" in keys)) {
    throw new Error("Expected a key pair.");
  }
  const spki = await crypto.subtle.exportKey("spki", keys.publicKey);
  return { privateKey: keys.privateKey, publicKey: Buffer.from(spki).toString("base64url") };
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function send(link: URL, path: string, body?: string): Promise<Answer> {
  const headers = { origin: link.origin, "content-type": "application/json" };
  const answer = await http.request({
    method: body === undefined ? "GET" : "POST",
    url: new URL(path, link.origin).href,
    headers,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: answer.status, body: answer.body };
}

async function pair(link: URL, key: BrowserKey): Promise<Answer> {
  const code = link.hash.replace(/^#pair=/, "");
  const body = { code, publicKey: key.publicKey, alg: "ed25519", label: "Test browser" };
  return send(link, "/pair", JSON.stringify(body));
}

interface Pairing {
  readonly link: URL;
  readonly deviceId: string;
  readonly key: BrowserKey;
}

async function signIn(at: Served, pairing: Pairing) {
  const { link, deviceId, key } = pairing;
  const { origin } = link;
  const client = createProtocolClient({
    operations,
    openSocket: () => new WebSocket(`ws://${link.host}/ws`, { origin }),
    client: { kind: "console", version: "test" },
    credential: { device: protocolIdSchema("consoleDevice").parse(deviceId) },
    proveDevice: async (nonce) => {
      const text = new TextEncoder().encode(deviceProofText({ nonce, origin }));
      const signature = await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, text);
      return Buffer.from(signature).toString("base64url");
    },
    clock: at.skeleton.clock,
    random: createSeededRandom(23),
    logger: createMemoryLogger({ subsystem: "browser" }),
  });
  const ready = await client.connect(AbortSignal.timeout(5_000));
  client.close();
  return ready;
}

describe("binference console", () => {
  it("prints a link whose browser pairs once and reaches the console", slow, async () => {
    const at = await serveConsole();
    const link = await consoleLink(at.machine);
    expect(link.hostname).toBe("127.0.0.1");
    expect(link.pathname).toBe("/");
    await expect(send(link, "/")).resolves.toStrictEqual({ status: 200, body: page });
    const key = await browserKey();
    const paired = await pair(link, key);
    expect(paired.status).toBe(201);
    const { deviceId } = JSON.parse(paired.body) as { readonly deviceId: string };
    const ready = await signIn(at, { link, deviceId, key });
    expect(ready.scopes).toContain("confirm");
    const again = await pair(link, await browserKey());
    expect(again.status).toBe(401);
    expect(JSON.parse(again.body)).toMatchObject({ error: { code: "auth.invalid" } });
  });

  it("refuses a link after its 10 minutes", slow, async () => {
    const at = await serveConsole();
    const link = await consoleLink(at.machine);
    await at.skeleton.clock.advance(tenMinutes);
    const late = await pair(link, await browserKey());
    expect(late.status).toBe(401);
    expect(JSON.parse(late.body)).toMatchObject({ error: { code: "auth.expired" } });
  });

  it("says in words where to open the link and that it works once", slow, async () => {
    const at = await serveConsole();
    const outcome = await runOn(at.machine, ["console"]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("Open this link in your browser before");
    expect(outcome.stdout).toMatch(/http:\/\/127\.0\.0\.1:\d+\/#pair=[\w-]{22}/);
  });
});
