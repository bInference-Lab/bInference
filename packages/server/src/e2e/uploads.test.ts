import { Buffer } from "node:buffer";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createUploadShelf } from "@binference/engine/chat";
import { testPng } from "@binference/engine/testing";
import { maxImageBytes } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { requestLocal } from "./local-http.js";
import { startTestServer, type TestServer } from "./test-server.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(5_000) });
const png = { contentType: "image/png", bytes: testPng.byteLength } as const;

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
    const { ticket } = uploads.ticket(png);
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
      path: `/upload/${uploads.ticket({ contentType: "image/png", bytes: maxImageBytes }).ticket}`,
      method: "POST",
      headers: { "content-length": String(maxImageBytes + 1) },
    });
    const gif = await post(server, {
      ticket: uploads.ticket({ contentType: "image/png", bytes: 6 }).ticket,
      body: new TextEncoder().encode("GIF89a"),
    });
    const foreign = await post(server, {
      ticket: uploads.ticket(png).ticket,
      body: testPng,
      origin: "https://evil.example",
    });
    expect([large.status, gif.status, foreign.status]).toStrictEqual([413, 415, 403]);
  });

  it("is not there through the public address, and takes POST only", async () => {
    const { server, uploads } = await start({ publicOrigin: "https://owner.example.ts.net" });
    const published = await requestLocal(server.httpPort, {
      path: `/upload/${uploads.ticket(png).ticket}`,
      method: "POST",
      headers: { host: "owner.example.ts.net" },
      body: testPng,
    });
    const read = await requestLocal(server.httpPort, { path: "/upload/x" });
    expect([published.status, read.status]).toStrictEqual([404, 405]);
  });
});
