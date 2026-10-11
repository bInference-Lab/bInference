import { Buffer } from "node:buffer";
// oxlint-disable-next-line eslint/no-restricted-imports -- the test serves a push service of its own on loopback
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Http } from "@binference/core";
import {
  createManualClock,
  createMemorySecretStore,
  createSeededRandom,
} from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { sendPushMessage } from "./send-push-message.js";
import { checkVapidAuthorization, createTestReceiver } from "./test-receiver.js";
import { openWebPushKey } from "./web-push-key.js";

const nowMs = 1_790_000_000_000;
const browser = createTestReceiver();

/** What the stand-in push service took in. */
interface Taken {
  readonly headers: IncomingMessage["headers"];
  readonly text: string;
}

const held: { server?: Server; origin: string; taken: Taken[] } = { origin: "", taken: [] };
const system: SystemHttp = createSystemHttp({ version: "2026.10.0" });
// The stand-in serves on loopback, which a real push request may never reach: this line lets it.
const http: Http = {
  request: async (request) => system.request({ ...request, publicOnly: false }),
};

// A push service on loopback: it opens each message as the browser would, then answers 201, or
// 410 for a subscription that is gone.
function standInPushService(): Server {
  return createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => {
      held.taken.push({ headers: request.headers, text: browser.open(Buffer.concat(parts)) });
      response.writeHead(request.url === "/gone" ? 410 : 201).end();
    });
  });
}

beforeAll(async () => {
  held.server = standInPushService();
  await new Promise<void>((resolve) => {
    held.server?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = held.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  held.origin = `http://127.0.0.1:${String(port)}`;
});

afterAll(async () => {
  await system.close();
  await new Promise<void>((resolve) => {
    held.server?.close(() => resolve());
  });
});

async function send(path: string, through: Http = http) {
  const key = await openWebPushKey(createMemorySecretStore({}), new AbortController().signal);
  const outcome = await sendPushMessage(
    {
      endpoint: `${held.origin}${path}`,
      keys: browser.keys,
      plaintext: Buffer.from('{"v":1,"kind":"opened"}'),
      ttlSec: 60,
      urgency: "high",
      topic: "a".repeat(32),
    },
    {
      http: through,
      key,
      clock: createManualClock(nowMs),
      random: createSeededRandom(2),
      signal: new AbortController().signal,
    },
  );
  return { outcome, key };
}

describe("a push message through a stand-in push service", () => {
  it("arrives over HTTP signed with the engine's key, and the browser opens it", async () => {
    held.taken = [];
    const { outcome, key } = await send("/send/a");
    expect(outcome).toStrictEqual({ kind: "sent", status: 201 });
    const [taken] = held.taken;
    expect(taken?.text).toBe('{"v":1,"kind":"opened"}');
    expect(taken?.headers).toMatchObject({
      "content-encoding": "aes128gcm",
      ttl: "60",
      urgency: "high",
      topic: "a".repeat(32),
    });
    expect(checkVapidAuthorization(String(taken?.headers.authorization))).toMatchObject({
      valid: true,
      claims: { aud: held.origin },
      key: key.publicKey,
    });
  });

  it("never reaches a push service on this machine through the real HTTP", async () => {
    held.taken = [];
    await expect(send("/send/a", system)).rejects.toMatchObject({ code: "http.private_address" });
    expect(held.taken).toStrictEqual([]);
  });

  it("answers gone for a subscription the push service no longer has", async () => {
    await expect(send("/gone")).resolves.toMatchObject({ outcome: { kind: "gone", status: 410 } });
  });
});
