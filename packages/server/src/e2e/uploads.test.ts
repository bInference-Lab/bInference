import { Buffer } from "node:buffer";
import { ok } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createUploadShelf } from "@binference/engine/chat";
import { testPng } from "@binference/engine/testing";
import { maxImageBytes } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { requestLocal } from "./local-http.js";
import { botToken, fieldsOf, initDataOf, miniOpen, ownerId, ticketFor } from "./mini-app-launch.js";
import { openRawSocket, type RawSocket } from "./raw-socket.js";
import { startTestServer, type TestServer } from "./test-server.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(5_000) });
const png = { contentType: "image/png", bytes: testPng.byteLength } as const;
// The console device's credential, which asks for the tickets on this machine.
const holder = "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001";

// A POST of the body to the ticket's path, from a browser at `origin` when one is given.
async function post(
  server: TestServer,
  sent: { readonly ticket: string; readonly body: Uint8Array; readonly origin?: string },
) {
  const headers = sent.origin === undefined ? {} : { origin: sent.origin };
  const path = `/upload/${sent.ticket}`;
  return requestLocal(server.httpPort, { path, method: "POST", headers, body: sent.body });
}

describe("uploading the owner's image", () => {
  let test: TestServer | undefined;

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  async function start(options: { readonly publicOrigin?: string } = {}) {
    const uploads = createUploadShelf({
      clock: createManualClock(0),
      random: createSeededRandom(5),
    });
    test = await startTestServer({ uploads, ...options });
    return { server: test, uploads };
  }

  it("keeps the body of a ticket once, and the runtime reads it by the upload id", async () => {
    const { server, uploads } = await start();
    const { ticket } = uploads.ticket(png, holder);
    const answer = await post(server, { ticket, body: testPng, origin: server.origin });
    expect(answer.status).toBe(201);
    const { upload } = JSON.parse(answer.body) as { readonly upload: string };
    expect(await uploads.read(upload, live())).toStrictEqual({
      ok: true,
      value: Buffer.from(testPng),
    });
    const again = await post(server, { ticket, body: testPng });
    expect([again.status, JSON.parse(again.body)]).toMatchObject([
      404,
      { error: { code: "image.not_found" } },
    ]);
  });

  it("refuses a body over 5 MiB, in another format, or from an origin that may not upload", async () => {
    const { server, uploads } = await start();
    // The declared size alone refuses it, before a byte of the body is read.
    const large = await requestLocal(server.httpPort, {
      path: `/upload/${uploads.ticket({ contentType: "image/png", bytes: maxImageBytes }, holder).ticket}`,
      method: "POST",
      headers: { "content-length": String(maxImageBytes + 1) },
    });
    const gif = await post(server, {
      ticket: uploads.ticket({ contentType: "image/png", bytes: 6 }, holder).ticket,
      body: new TextEncoder().encode("GIF89a"),
    });
    const foreign = await post(server, {
      ticket: uploads.ticket(png, holder).ticket,
      body: testPng,
      origin: "https://evil.example",
    });
    expect([large.status, gif.status, foreign.status]).toStrictEqual([413, 415, 403]);
  });

  it("takes POST only", async () => {
    const { server } = await start();
    const read = await requestLocal(server.httpPort, { path: "/upload/x" });
    expect(read.status).toBe(405);
  });
});

const publicHost = "owner.example.ts.net";
const publicOrigin = `https://${publicHost}`;

// The owner's Mini App, signed in through the public address.
async function signInMiniApp(server: TestServer): Promise<RawSocket> {
  const initData = initDataOf(fieldsOf({ userId: ownerId, atMs: server.clock.now() }));
  const raw = await openRawSocket(server.wsUrl, { origin: publicOrigin });
  raw.send(miniOpen(initData, await ticketFor(server)));
  await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
  return raw;
}

// The path `upload/start` gave the Mini App for the test PNG.
async function startUpload(raw: RawSocket): Promise<string> {
  raw.send({ t: "call", id: "u", op: "upload/start", args: png });
  const reply = await raw.next();
  if (reply.t !== "reply") {
    throw new Error(`upload/start answered ${reply.t}`);
  }
  return z.object({ url: z.string() }).parse(reply.result).url;
}

// The body to the path through the public address, from the origin when one is given.
async function postPublished(server: TestServer, path: string, origin?: string) {
  const headers = { host: publicHost, ...(origin === undefined ? {} : { origin }) };
  return requestLocal(server.httpPort, { path, method: "POST", headers, body: testPng });
}

describe("a Mini App uploading through the public address", () => {
  let test: TestServer | undefined;

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  // A server published at the public origin, whose `upload/start` holds each ticket for the
  // caller's credential, as the engine's does.
  async function start() {
    const uploads = createUploadShelf({
      clock: createManualClock(0),
      random: createSeededRandom(5),
    });
    test = await startTestServer({
      uploads,
      publicOrigin,
      miniApp: { botToken, ownerId: async () => ownerId },
      handlers: {
        "upload/start": async ({ args, caller }) => {
          const { ticket, expiresAt } = uploads.ticket(args, caller.credential);
          return ok({ url: `/upload/${ticket}`, expiresAt });
        },
      },
    });
    return { server: test, uploads };
  }

  it("takes the image on a ticket the signed-in Mini App asked for", async () => {
    const { server, uploads } = await start();
    const raw = await signInMiniApp(server);
    const answer = await postPublished(server, await startUpload(raw), publicOrigin);
    expect(answer.status).toBe(201);
    const { upload } = z.object({ upload: z.string() }).parse(JSON.parse(answer.body));
    expect(await uploads.read(upload, live())).toMatchObject({ ok: true });
    raw.close();
  });

  it("refuses an upload with no ticket, or one no Mini App asked for, as unknown", async () => {
    const { server, uploads } = await start();
    const raw = await signInMiniApp(server);
    const unknown = await postPublished(server, "/upload/none", publicOrigin);
    const local = `/upload/${uploads.ticket(png, server.cliToken.id).ticket}`;
    const notMiniApp = await postPublished(server, local, publicOrigin);
    expect([unknown.status, notMiniApp.status]).toStrictEqual([404, 404]);
    expect(JSON.parse(notMiniApp.body)).toMatchObject({ error: { code: "image.not_found" } });
    raw.close();
  });

  it("refuses an upload from no origin or another one, and once the Mini App closed", async () => {
    const { server } = await start();
    const raw = await signInMiniApp(server);
    const bare = await postPublished(server, await startUpload(raw));
    const local = await postPublished(server, await startUpload(raw), server.origin);
    const path = await startUpload(raw);
    raw.close();
    await raw.closed;
    const closed = await postPublished(server, path, publicOrigin);
    expect([bare.status, local.status, closed.status]).toStrictEqual([403, 403, 404]);
  });
});
