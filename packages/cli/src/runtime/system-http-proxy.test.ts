import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the test serves the hosts behind the stand-in proxy from a loopback server
import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { inspect } from "node:util";
import {
  BinferenceError,
  createSecret,
  directRoute,
  type HostLookup,
  outboundRouteOf,
} from "@binference/core";
import { type StandInProxy, startStandInProxy } from "@binference/platform/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createSystemHttp, type SystemHttp } from "./system-http.js";

// The hosts a test names never resolve: only the proxy reaches them, at the loopback server.
const viaProxy = "http://api.example.test";
const credentials = "owner:hunter2-proxy-pass";

const held: { server?: Server; port: number; closed: number; sockets?: WebSocketServer } = {
  port: 0,
  closed: 0,
};
const proxies: StandInProxy[] = [];
const adapters: SystemHttp[] = [];
const servers: NetServer[] = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

// A request to /slow waits for the test's word, so it is under way while the test acts.
const slow = deferred();
const slowArrived = deferred();

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  const settle = { resolve: (): void => undefined };
  const promise = new Promise<void>((resolve) => {
    settle.resolve = resolve;
  });
  return { promise, resolve: () => settle.resolve() };
}

beforeAll(async () => {
  held.server = createServer((request, response) => {
    const answer = `${request.headers.host ?? ""} ${request.headers["user-agent"] ?? ""}`;
    if (request.url === "/slow") {
      slowArrived.resolve();
      void slow.promise.then(() => response.end(answer));
      return;
    }
    response.end(answer);
  });
  held.sockets = new WebSocketServer({ server: held.server });
  held.port = await listen(held.server);
  const spare = createServer();
  held.closed = await listen(spare);
  await new Promise<void>((resolve) => {
    spare.close(() => resolve());
  });
});

afterEach(async () => {
  await Promise.all(adapters.splice(0).map(async (made) => made.close()));
  await Promise.all(proxies.splice(0).map(async (made) => made.close()));
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

afterAll(async () => {
  held.sockets?.close();
  await new Promise<void>((resolve) => {
    held.server?.close(() => resolve());
  });
});

async function standIn(options: { readonly refuseWith?: number } = {}): Promise<StandInProxy> {
  const started = await startStandInProxy({ toPort: held.port, credentials, ...options });
  proxies.push(started);
  return started;
}

// The names a test asks for resolve to this machine, as a name an attacker points home would.
const answersLoopback: HostLookup = (_hostname, _options, callback) => {
  callback(null, [{ address: "127.0.0.1", family: 4 }]);
};

function adapter(): SystemHttp {
  const created = createSystemHttp({ version: "1.2.3", lookup: answersLoopback });
  adapters.push(created);
  return created;
}

// The stand-in's URL with the owner's credentials in it, as network.proxy names it.
function proxyUrl(stand: { readonly url: string }, userInfo = credentials): string {
  return stand.url.replace("http://", `http://${userInfo}@`);
}

function routeThrough(
  url: string,
  noProxy: readonly string[] = [],
): ReturnType<typeof outboundRouteOf> {
  return outboundRouteOf({ proxy: createSecret(url), noProxy });
}

const live = (): AbortSignal => new AbortController().signal;

async function failure(run: Promise<unknown>): Promise<BinferenceError> {
  const caught = await run.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof BinferenceError)) {
    throw new Error("expected a BinferenceError");
  }
  return caught;
}

// Everything a log line or an error report could print about an error.
function printed(error: Readonly<Error>): string {
  return [
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(error),
    error.stack,
  ].join("\n");
}

describe("the system Http adapter through the owner's proxy", () => {
  it("sends a request through the proxy's tunnel, with the proxy's credentials", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const answer = await http.request({ method: "GET", url: `${viaProxy}/ok`, signal: live() });
    expect(answer.body).toBe("api.example.test binference/1.2.3");
    expect(stand.tunnels).toStrictEqual(["api.example.test:80"]);
  });

  it("downloads through the proxy", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const answer = await http.download({
      url: `${viaProxy}/a.jpg`,
      maxBytes: 1024,
      signal: live(),
    });
    expect(Buffer.from(answer.bytes).toString("utf8")).toContain("api.example.test");
    expect(stand.tunnels).toStrictEqual(["api.example.test:80"]);
  });

  it("goes direct to this machine and to the no-proxy list's hosts", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand), ["api.example.test"]));
    const local = `http://127.0.0.1:${String(held.port)}/ok`;
    await expect(
      http.request({ method: "GET", url: local, signal: live() }),
    ).resolves.toMatchObject({
      status: 200,
    });
    // The name resolves here to the loopback server, which only a direct request reaches.
    const listed = `http://api.example.test:${String(held.port)}/ok`;
    await expect(
      http.request({ method: "GET", url: listed, signal: live() }),
    ).resolves.toMatchObject({ status: 200 });
    expect(stand.tunnels).toStrictEqual([]);
  });

  it("puts a new route in force for the next request", async () => {
    const stand = await standIn();
    const http = adapter();
    const local = `http://127.0.0.1:${String(held.port)}/`;
    http.use(routeThrough(proxyUrl(stand)));
    await http.request({ method: "GET", url: `${viaProxy}/one`, signal: live() });
    http.use(directRoute);
    const named = `http://api.example.test:${String(held.port)}/`;
    await expect(
      http.request({ method: "GET", url: named, signal: live() }),
    ).resolves.toMatchObject({ status: 200 });
    await http.request({ method: "GET", url: local, signal: live() });
    http.use(routeThrough(proxyUrl(stand)));
    await http.request({ method: "GET", url: `${viaProxy}/two`, signal: live() });
    expect(stand.tunnels).toStrictEqual(["api.example.test:80", "api.example.test:80"]);
  });

  it("holds every request but the direct ones while the proxy set is unusable", async () => {
    const http = adapter();
    http.use(outboundRouteOf({ proxy: "unread", noProxy: [] }));
    const refused = await failure(http.request({ method: "GET", url: viaProxy, signal: live() }));
    expect(refused).toMatchObject({ code: "http.proxy_unusable", retryable: false });
    const local = `http://127.0.0.1:${String(held.port)}/`;
    await expect(
      http.request({ method: "GET", url: local, signal: live() }),
    ).resolves.toMatchObject({
      status: 200,
    });
  });

  it("reads a 407 as the proxy asking for credentials", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand, "owner:wrong-pass")));
    const refused = await failure(http.request({ method: "GET", url: viaProxy, signal: live() }));
    expect(refused).toMatchObject({
      code: "http.proxy_auth",
      details: { method: "GET", origin: viaProxy },
    });
    expect(printed(refused)).not.toContain("wrong-pass");
    expect(printed(refused)).not.toContain(new URL(stand.url).host);
  });

  it.each([403, 502])("reads a %d answer to the tunnel as the proxy refusing", async (status) => {
    const stand = await standIn({ refuseWith: status });
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const refused = await failure(http.request({ method: "GET", url: viaProxy, signal: live() }));
    expect(refused).toMatchObject({ code: "http.proxy_refused", details: { status } });
  });

  it("names no proxy address or credentials when the proxy cannot be reached", async () => {
    const http = adapter();
    const down = `http://${credentials}@127.0.0.1:${String(held.closed)}`;
    http.use(routeThrough(down));
    const refused = await failure(http.request({ method: "POST", url: viaProxy, signal: live() }));
    expect(refused).toMatchObject({ code: "http.proxy_unreachable", retryable: true });
    expect(printed(refused)).not.toContain(String(held.closed));
    expect(printed(refused)).not.toContain("hunter2");
  });

  it("refuses a public-only request through the proxy whose name resolves to no public address", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const request = { method: "GET", url: viaProxy, signal: live(), publicOnly: true } as const;
    const refused = await failure(http.request(request));
    expect(refused.code).toBe("http.private_address");
    expect(stand.tunnels).toStrictEqual([]);
  });

  it("opens a WebSocket through the proxy", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const socket = http.openSocket("ws://api.example.test/ws");
    await once(socket as unknown as EventTarget, "open");
    socket.close();
    expect(stand.tunnels).toStrictEqual(["api.example.test:80"]);
  });

  it("refuses to open a WebSocket while the proxy set is unusable", () => {
    const http = adapter();
    http.use(outboundRouteOf({ proxy: "unread", noProxy: [] }));
    expect(() => http.openSocket("wss://node.example.test/ws")).toThrow(
      expect.objectContaining({ code: "http.proxy_unusable" }),
    );
  });
});

// The server name a TLS ClientHello asks for, read from its bytes as RFC 8446 lays them out.
function serverNameOf(hello: Readonly<Buffer>): string | undefined {
  const reader = { at: 5 + 4 + 2 + 32 };
  const skip = (lengthBytes: number): void => {
    reader.at += lengthBytes + hello.readUIntBE(reader.at, lengthBytes);
  };
  skip(1);
  skip(2);
  skip(1);
  const end = reader.at + 2 + hello.readUInt16BE(reader.at);
  reader.at += 2;
  while (reader.at + 4 <= end) {
    const type = hello.readUInt16BE(reader.at);
    const length = hello.readUInt16BE(reader.at + 2);
    if (type === 0) {
      const nameLength = hello.readUInt16BE(reader.at + 7);
      return hello.subarray(reader.at + 9, reader.at + 9 + nameLength).toString("ascii");
    }
    reader.at += 4 + length;
  }
  return undefined;
}

// A server that reads a TLS ClientHello's server name and closes, as a host behind the tunnel.
async function helloReader(): Promise<{ readonly port: number; readonly name: Promise<string> }> {
  const heard = deferredName();
  const server = createNetServer((socket) => {
    socket.once("data", (hello: Buffer) => {
      heard.resolve(serverNameOf(hello) ?? "");
      socket.destroy();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { port, name: heard.promise };
}

function deferredName(): {
  readonly promise: Promise<string>;
  readonly resolve: (name: string) => void;
} {
  const settle = { resolve: (_name: string): void => undefined };
  const promise = new Promise<string>((resolve) => {
    settle.resolve = resolve;
  });
  return { promise, resolve: (name) => settle.resolve(name) };
}

// A name that resolves here to a public address, as an attacker's name answers binference.
const answersPublic: HostLookup = (_hostname, _options, callback) => {
  callback(null, [{ address: "93.184.216.34", family: 4 }]);
};

describe("the system Http adapter's routes", () => {
  it("refuses every request and socket before a route is in force", async () => {
    const http = createSystemHttp({ version: "1.2.3" });
    adapters.push(http);
    const refused = await failure(http.request({ method: "GET", url: viaProxy, signal: live() }));
    expect(refused.code).toBe("http.no_route");
    expect(() => http.openSocket("ws://api.example.test/ws")).toThrow(
      expect.objectContaining({ code: "http.no_route" }),
    );
  });

  it("tunnels a public-only http request to the address it checked, never to the name", async () => {
    const stand = await standIn();
    const http = createSystemHttp({ version: "1.2.3", lookup: answersPublic });
    adapters.push(http);
    http.use(routeThrough(proxyUrl(stand)));
    const url = "http://rebind.example.test:8080/ok";
    const answer = await http.request({ method: "GET", url, signal: live(), publicOnly: true });
    expect(stand.tunnels).toStrictEqual(["93.184.216.34:8080"]);
    expect(answer.body).toBe("rebind.example.test:8080 binference/1.2.3");
  });

  it("keeps the name of a public-only https request, which TLS binds", async () => {
    const stand = await standIn({ refuseWith: 502 });
    const http = createSystemHttp({ version: "1.2.3", lookup: answersPublic });
    adapters.push(http);
    http.use(routeThrough(proxyUrl(stand)));
    const url = "https://rebind.example.test/ok";
    await failure(http.request({ method: "GET", url, signal: live(), publicOnly: true }));
    expect(stand.tunnels).toStrictEqual(["rebind.example.test:443"]);
  });

  it("speaks TLS to the host through the tunnel, naming the host", async () => {
    const reader = await helloReader();
    const stand = await startStandInProxy({ toPort: reader.port, credentials });
    proxies.push(stand);
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const refused = await failure(
      http.request({ method: "GET", url: "https://tls.example.test/", signal: live() }),
    );
    await expect(reader.name).resolves.toBe("tls.example.test");
    expect(refused.code).toBe("http.unreachable");
    expect(stand.tunnels).toStrictEqual(["tls.example.test:443"]);
  });

  it("lets a request under way finish on its route after a switch", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(routeThrough(proxyUrl(stand)));
    const answer = http.request({ method: "GET", url: `${viaProxy}/slow`, signal: live() });
    await slowArrived.promise;
    http.use(directRoute);
    slow.resolve();
    await expect(answer).resolves.toMatchObject({ status: 200 });
    expect(stand.tunnels).toStrictEqual(["api.example.test:80"]);
  });

  it("closes a socket opened by the old route, so it opens again through the proxy", async () => {
    const stand = await standIn();
    const http = adapter();
    http.use(directRoute);
    const url = `ws://heads.example.test:${String(held.port)}/ws`;
    const first = http.openSocket(url);
    await once(first as unknown as EventTarget, "open");
    expect(stand.tunnels).toStrictEqual([]);
    const closed = once(first as unknown as EventTarget, "close");
    http.use(routeThrough(proxyUrl(stand)));
    await closed;
    const second = http.openSocket(url);
    await once(second as unknown as EventTarget, "open");
    second.close();
    expect(stand.tunnels).toStrictEqual([`heads.example.test:${String(held.port)}`]);
  });
});
