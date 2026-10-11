import { afterEach, describe, expect, it } from "vitest";
import { requestLocal } from "./local-http.js";
import { startTestServer, type TestServer } from "./test-server.js";

const page = "<!doctype html><title>console</title>";
const script = "console.log(1)";
const consoleFiles = new Map([
  ["index.html", new TextEncoder().encode(page)],
  ["assets/index-1a2b.js", new TextEncoder().encode(script)],
  ["mark.svg", new TextEncoder().encode("<svg/>")],
]);

describe("the console's files", () => {
  let test: TestServer | undefined;

  async function start(withFiles = true): Promise<TestServer> {
    test = await startTestServer(withFiles ? { consoleFiles } : {});
    return test;
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  it("serves the page at / with a policy that loads only its own files", async () => {
    const server = await start();
    const answer = await requestLocal(server.httpPort, { path: "/" });
    expect(answer).toMatchObject({ status: 200, body: page });
    expect(answer.headers).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    expect(answer.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(answer.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("serves the same page at /mini, framable by Telegram's web client only", async () => {
    const server = await start();
    const answer = await requestLocal(server.httpPort, { path: "/mini" });
    expect(answer).toMatchObject({ status: 200, body: page });
    expect(answer.headers["x-frame-options"]).toBeUndefined();
    expect(answer.headers["content-security-policy"]).toContain(
      "frame-ancestors https://web.telegram.org",
    );
  });

  it("serves the page at each of its screens' paths", async () => {
    const server = await start();
    await expect(requestLocal(server.httpPort, { path: "/ledger" })).resolves.toMatchObject({
      status: 200,
      body: page,
    });
  });

  it("serves a built file with its type, cached for good under assets", async () => {
    const server = await start();
    const answer = await requestLocal(server.httpPort, { path: "/assets/index-1a2b.js" });
    expect(answer).toMatchObject({ status: 200, body: script });
    expect(answer.headers).toMatchObject({
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    });
    const mark = await requestLocal(server.httpPort, { path: "/mark.svg" });
    expect(mark.headers).toMatchObject({
      "content-type": "image/svg+xml",
      "cache-control": "no-cache",
    });
  });

  it.each([
    ["a file it does not hold", "/assets/missing.js", "GET"],
    ["a path that does not decode", "/assets/%E0.js", "GET"],
    ["a write to the page", "/", "POST"],
    ["the WebSocket's path without an upgrade", "/ws", "GET"],
  ])("answers 404 for %s", async (_name, path, method) => {
    const server = await start();
    await expect(requestLocal(server.httpPort, { path, method })).resolves.toMatchObject({
      status: 404,
    });
  });

  it("answers 404 at / when it has no console files", async () => {
    const server = await start(false);
    await expect(requestLocal(server.httpPort, { path: "/" })).resolves.toMatchObject({
      status: 404,
    });
  });
});
