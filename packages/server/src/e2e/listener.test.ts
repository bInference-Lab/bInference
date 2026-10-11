import type { EngineState } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { requestLocal } from "./local-http.js";
import { openFrame, openRawSocket } from "./raw-socket.js";
import { startTestServer, type TestServer } from "./test-server.js";

async function fetchLocal(port: number, path: string, method = "GET") {
  const { status, body } = await requestLocal(port, { path, method });
  return { status, body };
}

describe("the HTTP listener", () => {
  let test: TestServer | undefined;
  let state: EngineState = "ready";

  async function start(limits = {}): Promise<TestServer> {
    test = await startTestServer({ state: () => state, limits });
    return test;
  }

  afterEach(async () => {
    state = "ready";
    await test?.close();
    test = undefined;
  });

  it("answers health with the engine's state", async () => {
    const server = await start();
    await expect(fetchLocal(server.httpPort, "/health")).resolves.toStrictEqual({
      status: 200,
      body: '{"state":"ready"}',
    });
    state = "starting";
    await expect(fetchLocal(server.httpPort, "/health")).resolves.toStrictEqual({
      status: 503,
      body: '{"state":"starting"}',
    });
    state = "locked";
    await expect(fetchLocal(server.httpPort, "/health")).resolves.toStrictEqual({
      status: 200,
      body: '{"state":"locked"}',
    });
  });

  it.each([
    { name: "another path", path: "/nothing", method: "GET", status: 404 },
    { name: "another method on health", path: "/health", method: "POST", status: 405 },
  ] as const)("answers $name with its status", async ({ path, method, status }) => {
    const server = await start();
    await expect(fetchLocal(server.httpPort, path, method)).resolves.toMatchObject({ status });
  });

  it("refuses an upgrade on a path other than the WebSocket's", async () => {
    const server = await start();
    const url = `ws://127.0.0.1:${String(server.httpPort)}/other`;
    await expect(openRawSocket(url, { origin: server.origin })).rejects.toThrow("404");
  });

  it("refuses a connection past the most it holds", async () => {
    const server = await start({ maxConnections: 1 });
    const first = await openRawSocket(server.ipcUrl);
    await expect(openRawSocket(server.wsUrl, { origin: server.origin })).rejects.toThrow("503");
    first.close();
  });

  it("drops a connection that stops answering pings", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl, { answersPings: false });
    raw.send(openFrame({ token: server.cliToken.secret }));
    await raw.next();
    await server.clock.advance(20_000);
    await server.clock.advance(20_000);
    await server.clock.advance(20_000);
    await server.clock.advance(20_000);
    await expect(raw.closed).resolves.toBe(1006);
  });

  it("says bye to every connection when it closes, and takes no more", async () => {
    const server = await start();
    const raw = await openRawSocket(server.ipcUrl);
    raw.send(openFrame({ token: server.cliToken.secret }));
    await raw.next();
    await server.close();
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "engine.stopping" });
    await expect(raw.closed).resolves.toBe(1001);
    await expect(openRawSocket(server.ipcUrl)).rejects.toBeInstanceOf(Error);
  });
});
