import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { requestLocal } from "./local-http.js";
import { startTestServer, type TestServer } from "./test-server.js";

const page = "<!doctype html><title>console</title>";
const script = "console.log(1)";
const consoleFiles = new Map<string, Uint8Array>([
  ["index.html", new TextEncoder().encode(page)],
  ["assets/index-1a2b.js", new TextEncoder().encode(script)],
  ["assets/index-1a2b.js.br", brotliCompressSync(script)],
  ["assets/index-1a2b.js.gz", gzipSync(script)],
  ["mark.svg", new TextEncoder().encode("<svg/>")],
]);
const scriptPath = "/assets/index-1a2b.js";
const asking = (coding: string) => ({ path: scriptPath, headers: { "accept-encoding": coding } });

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
    expect(answer.headers["content-security-policy"]).toContain("img-src 'self' data: blob:;");
  });

  it("turns off every browser feature the console does not use", async () => {
    const server = await start();
    const policy = String(
      (await requestLocal(server.httpPort, { path: "/" })).headers["permissions-policy"],
    );
    const features = policy.split(", ");
    expect(features).toContain("camera=()");
    expect(features).toContain("microphone=()");
    expect(features).toContain("geolocation=()");
    expect(features).toContain("payment=()");
    expect(features.every((feature) => /^[a-z-]+=\(\)$/.test(feature))).toBe(true);
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

  it("runs no inline style on the page and shares no answer with another site", async () => {
    const server = await start();
    const answer = await requestLocal(server.httpPort, { path: "/" });
    expect(answer.headers["content-security-policy"]).toContain("style-src 'self';");
    expect(answer.headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(answer.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it.each([
    ["a script", "/assets/index-1a2b.js", 200],
    ["an image opened on its own", "/mark.svg", 200],
    ["a file it does not hold", "/assets/missing.js", 404],
    ["health", "/health", 200],
  ])(
    "sends %s with a policy that loads nothing and the same guards",
    async (_name, path, status) => {
      const server = await start();
      const answer = await requestLocal(server.httpPort, { path });
      expect(answer.status).toBe(status);
      expect(answer.headers).toMatchObject({
        "content-security-policy":
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "cross-origin-resource-policy": "same-origin",
      });
      expect(String(answer.headers["permissions-policy"])).toContain("camera=()");
    },
  );

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

  it("sends a file in the coding the browser takes best, and says it varies by it", async () => {
    const server = await start();
    const brotli = await requestLocal(server.httpPort, asking("gzip, deflate, br, zstd"));
    expect(brotli.headers).toMatchObject({ "content-encoding": "br", vary: "accept-encoding" });
    expect(brotliDecompressSync(brotli.bytes).toString()).toBe(script);
    expect(brotli.headers["content-length"]).toBe(String(brotli.bytes.byteLength));
    const gzip = await requestLocal(server.httpPort, asking("gzip"));
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gzip.bytes).toString()).toBe(script);
    const plain = await requestLocal(server.httpPort, asking("identity"));
    expect(plain).toMatchObject({ body: script, headers: { vary: "accept-encoding" } });
    expect(plain.headers["content-encoding"]).toBeUndefined();
  });

  it("names no coding for a file the build kept as it is", async () => {
    const server = await start();
    const mark = await requestLocal(server.httpPort, {
      path: "/mark.svg",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(mark.headers["content-encoding"]).toBeUndefined();
    expect(mark.headers["vary"]).toBeUndefined();
  });

  it.each([
    ["a compressed copy by its own name", `${scriptPath}.br`, "GET"],
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
