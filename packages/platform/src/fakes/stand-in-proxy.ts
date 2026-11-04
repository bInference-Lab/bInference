// oxlint-disable-next-line eslint/no-restricted-imports -- a stand-in proxy on the loopback for tests: no outbound request
import { createServer, type IncomingMessage } from "node:http";
import { connect, type Socket } from "node:net";

/** The owner's proxy as a test stands it in, on the loopback. */
export interface StandInProxy {
  /** Its URL, such as `http://127.0.0.1:4000`, without credentials. */
  readonly url: string;
  /** The `host:port` each tunnel asked for, oldest first, refused ones too. */
  readonly tunnels: readonly string[];
  /** Resolves once a tunnel to the host, by name and without its port, has been asked for. */
  asked(host: string): Promise<void>;
  close(): Promise<void>;
}

/** Where the stand-in sends each tunnel, and what it asks of one. */
export interface StandInProxyOptions {
  /** The loopback port every tunnel reaches, whatever host it names. */
  readonly toPort: number;
  /** The `user:password` a tunnel must carry; without it, or with others, it answers 407. */
  readonly credentials?: string;
  /** A status it answers every tunnel with in place of opening it, such as 403 or 502. */
  readonly refuseWith?: number;
}

// A tunnel's host without its port.
function hostOf(tunnelled: string): string {
  return tunnelled.replace(/:\d+$/, "");
}

function answerOf(request: IncomingMessage, options: StandInProxyOptions): number {
  const expected =
    options.credentials === undefined
      ? undefined
      : `Basic ${Buffer.from(options.credentials).toString("base64")}`;
  if (expected !== undefined && request.headers["proxy-authorization"] !== expected) {
    return 407;
  }
  return options.refuseWith ?? 200;
}

function tunnel(
  client: Socket,
  head: Buffer,
  to: { readonly port: number; readonly open: Set<Socket> },
): void {
  const { open } = to;
  const upstream = connect(to.port, "127.0.0.1", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  open.add(upstream);
  upstream.on("close", () => open.delete(upstream));
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
}

/**
 * Starts a stand-in HTTP proxy on `127.0.0.1` at a free port. It answers each `CONNECT` with
 * 200 and a tunnel to `toPort` on the loopback, or with the status the options name, 407 when
 * the credentials are missing or wrong, and records the host each tunnel asked for, which a test
 * can wait for. It serves no request but `CONNECT`. Close it when the test ends.
 */
export async function startStandInProxy(options: StandInProxyOptions): Promise<StandInProxy> {
  const tunnels: string[] = [];
  const waiters = new Map<string, (() => void)[]>();
  const open = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(405).end();
  });
  server.on("connect", (request: IncomingMessage, client: Socket, head: Buffer) => {
    tunnels.push(request.url ?? "");
    const host = hostOf(request.url ?? "");
    waiters.get(host)?.forEach((resolve) => resolve());
    waiters.delete(host);
    open.add(client);
    client.on("close", () => open.delete(client));
    const status = answerOf(request, options);
    if (status !== 200) {
      client.end(`HTTP/1.1 ${String(status)} Stand-in\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    tunnel(client, head, { port: options.toPort, open });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    tunnels,
    asked: async (host) =>
      tunnels.some((tunnelled) => hostOf(tunnelled) === host)
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiters.set(host, [...(waiters.get(host) ?? []), resolve]);
          }),
    close: async () => {
      for (const socket of open) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
