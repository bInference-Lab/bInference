import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the smoke's stand-in proxy on the loopback, which the binference under test names as its own
import { createServer as createProxyServer, type IncomingMessage } from "node:http";
// oxlint-disable-next-line eslint/no-restricted-imports -- the smoke serves its fakes over TLS on the loopback; nothing ships a listener
import { createServer as createTlsServer } from "node:https";
import { connect, type Server, type Socket } from "node:net";
import type { Http } from "@binference/core";
import { answerFromFakes } from "../e2e/fake-service-answer.js";
import { makeSmokeCertificate } from "./smoke-certificate.js";

/**
 * The outside services of the packed-install smoke as the binference under test reaches them: an
 * HTTP proxy on the loopback, which it names in `network.proxy`, that opens each tunnel to a host
 * with a fake to the fakes' TLS server, and every other tunnel, such as to a BNB Smart Chain RPC,
 * to the host it names.
 */
export interface SmokeEdge {
  /** The proxy's URL, such as `http://127.0.0.1:4000`. */
  readonly proxyUrl: string;
  /** The certificate the fakes serve, which the processes under test trust. */
  readonly cert: string;
  /** The `host:port` of each tunnel asked for, oldest first. */
  readonly tunnels: readonly string[];
  close(): Promise<void>;
}

function portOf(server: Server): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return portOf(server);
}

// One tunnel: the client's bytes to the target and back, each end closing the other.
function tunnel(client: Socket, head: Buffer, target: { host: string; port: number }): Socket {
  const upstream = connect(target.port, target.host, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
  return upstream;
}

function targetOf(asked: string, fakes: ReadonlyMap<string, Http>, tlsPort: number) {
  const url = new URL(`http://${asked}`);
  const host = url.hostname;
  return fakes.has(host)
    ? { host: "127.0.0.1", port: tlsPort }
    : { host, port: Number(url.port === "" ? "443" : url.port) };
}

/**
 * Starts the smoke's edge on `127.0.0.1`: a TLS server that answers from the fakes by host name,
 * with a certificate made for those names, and the proxy in front of it. Close it when the smoke
 * ends.
 */
export async function startSmokeEdge(
  fakes: ReadonlyMap<string, Http>,
  nowMs: number,
): Promise<SmokeEdge> {
  const made = makeSmokeCertificate([...fakes.keys()], nowMs);
  const tls = createTlsServer({ cert: made.cert, key: made.key }, answerFromFakes(fakes));
  const tlsPort = await listen(tls);
  const tunnels: string[] = [];
  const open = new Set<Socket>();
  const proxy = createProxyServer((_request, response) => {
    response.writeHead(405).end();
  });
  proxy.on("connect", (request: IncomingMessage, client: Socket, head: Buffer) => {
    const asked = request.url ?? "";
    tunnels.push(asked);
    const upstream = tunnel(client, head, targetOf(asked, fakes, tlsPort));
    [client, upstream].forEach((socket) => {
      open.add(socket);
      socket.on("close", () => open.delete(socket));
    });
  });
  const proxyPort = await listen(proxy);
  return {
    proxyUrl: `http://127.0.0.1:${String(proxyPort)}`,
    cert: made.cert,
    tunnels,
    close: async () => {
      open.forEach((socket) => socket.destroy());
      tls.closeAllConnections();
      await Promise.all([proxy, tls].map(async (server) => once(server.close(), "close")));
    },
  };
}
