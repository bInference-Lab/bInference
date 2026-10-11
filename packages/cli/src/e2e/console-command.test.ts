import { Buffer } from "node:buffer";
import { createHmac, type webcrypto } from "node:crypto";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { createSecret } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import {
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "@binference/engine/testing";
import { deviceProofText, operations, protocolIdSchema } from "@binference/protocol";
import { createFakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { Api } from "grammy";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { TelegramParts } from "../compose/compose-telegram.js";
import { type SkeletonComposition, skeletonCompositions } from "../compose/test-skeleton.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const browsers: ProtocolClient[] = [];
const page = "<!doctype html><title>console</title>";
const tenMinutes = 10 * 60 * 1000;
const ownerId = 7_012_345_678;
const paperIcon = String.fromCodePoint(0x1f9ea);
// The browser's requests go out as the engine's own outbound requests do, over a real socket.
const http = createSystemHttp({ version: "test" });

afterAll(async () => http.close());

afterEach(async () => {
  browsers.splice(0).forEach((client) => client.close());
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
  /** The HTTP listener's own origin. */
  readonly origin: string;
}

// The engine of a machine, with its HTTP listener on a free port and a one-page console.
async function serveConsole(telegram?: TelegramParts): Promise<Served> {
  const machine = await machines.create(testNowMs);
  const consoleFiles = new Map([["index.html", new TextEncoder().encode(page)]]);
  const browser = { http: { host: "127.0.0.1", port: 0 }, consoleFiles };
  const bot = telegram === undefined ? {} : { telegram };
  const skeleton = await serveSkeleton(machine, selfHosted(), { browser, ...bot });
  served.push(skeleton);
  const address = await skeleton.composed.server.start(AbortSignal.timeout(5_000));
  return { machine, skeleton, origin: `http://127.0.0.1:${String(address?.port)}` };
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

function browserClient(at: Served, pairing: Pairing): ProtocolClient {
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
  browsers.push(client);
  return client;
}

async function signIn(at: Served, pairing: Pairing) {
  return browserClient(at, pairing).connect(AbortSignal.timeout(5_000));
}

// Pairs a browser with a fresh link from `binference console`.
async function pairBrowser(at: Served): Promise<Pairing> {
  const link = await consoleLink(at.machine);
  const key = await browserKey();
  const { deviceId } = JSON.parse((await pair(link, key)).body) as { readonly deviceId: string };
  return { link, deviceId, key };
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

  it(
    "confirms a card from the console, and its Telegram copy becomes the receipt",
    slow,
    async () => {
      const botApi = createFakeBotApi();
      const owners = createMemoryOwnerStore();
      await owners.bind({ userId: ownerId, pairedAtMs: 1 }, { signal: AbortSignal.timeout(5_000) });
      const api = new Api(fakeBotToken, { fetch: botApi.fetch });
      const at = await serveConsole({
        api,
        owners,
        copies: createMemoryCardCopyStore(),
        botToken: createSecret(fakeBotToken),
      });
      const signal = AbortSignal.timeout(10_000);
      const cli = at.skeleton.client;
      await cli.call("portfolio/resetPaper", { agent: testAgent }, { signal });
      const swap = {
        kind: "swap",
        agent: testAgent,
        wallet: testWallet,
        reason: "Rotate into the token",
        from: testCoin,
        to: testToken,
        amount: { base: 10n ** 16n },
      } as const;
      const { intent } = await cli.call("intent/propose", swap, { signal });
      const telegram = at.skeleton.composed.telegram;
      await telegram?.idle();
      expect(botApi.messages()).toMatchObject([{ chatId: ownerId, buttons: [[{}, {}]] }]);
      const browser = browserClient(at, await pairBrowser(at));
      await browser.connect(signal);
      const shown = await browser.call("intent/card", { intent }, { signal });
      const args = { intent, card: shown.card, cardVersion: shown.version };
      await expect(browser.call("intent/confirm", args, { signal })).resolves.toMatchObject({
        state: "paper_filled",
      });
      await telegram?.idle();
      expect(botApi.messages()).toMatchObject([
        {
          chatId: ownerId,
          text: `${paperIcon} Paper fill: 0.01 FAKE → 20,000,000,000 TKN`,
          buttons: [],
        },
      ]);
    },
  );

  it(
    "signs the owner's Mini App in with the bot's token and takes its unfreeze",
    slow,
    async () => {
      const botApi = createFakeBotApi();
      const owners = createMemoryOwnerStore();
      await owners.bind({ userId: ownerId, pairedAtMs: 1 }, { signal: AbortSignal.timeout(5_000) });
      const api = new Api(fakeBotToken, { fetch: botApi.fetch });
      const copies = createMemoryCardCopyStore();
      const at = await serveConsole({ api, owners, copies, botToken: createSecret(fakeBotToken) });
      const signal = AbortSignal.timeout(10_000);
      await at.skeleton.client.call("safety/freeze", {}, { signal });
      const mini = miniAppClient(at, signedLaunch(ownerId, at.skeleton.clock.now()));
      const ready = await mini.connect(signal);
      expect(ready.scopes).toStrictEqual(["read", "chat", "confirm", "loosen"]);
      await expect(mini.call("safety/unfreeze", {}, { signal })).resolves.toMatchObject({
        intent: /^int_/,
      });
    },
  );
});

// A launch's `initData` as Telegram signs it with the owner's bot token, by Telegram's rule; the
// fields are listed in key order, as the data-check string takes them.
function signedLaunch(userId: number, atMs: number): string {
  const fields = new URLSearchParams([
    ["auth_date", String(Math.floor(atMs / 1_000))],
    ["query_id", "AAHdF6IQAAAAAN0XohDhrOrc"],
    ["user", JSON.stringify({ id: userId, first_name: "Owner" })],
  ]);
  const checked = [...fields].map(([key, value]) => `${key}=${value}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(fakeBotToken).digest();
  fields.set("hash", createHmac("sha256", key).update(checked).digest("hex"));
  return fields.toString();
}

function miniAppClient(at: Served, initData: string): ProtocolClient {
  const { origin } = at;
  const client = createProtocolClient({
    operations,
    openSocket: () => new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin }),
    client: { kind: "mini", version: "test" },
    credential: { telegram: { initData } },
    clock: at.skeleton.clock,
    random: createSeededRandom(29),
    logger: createMemoryLogger({ subsystem: "mini" }),
  });
  browsers.push(client);
  return client;
}
