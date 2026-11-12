import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- a TLS server on the loopback for tests: no outbound request
import { createServer, type Server } from "node:https";
import type { TLSSocket } from "node:tls";
import { BinferenceError, createSecret } from "@binference/core";
import { httpContract } from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestCertificate, type TestCertificate } from "../fakes/test-certificates.js";
import { type ClientCertHttp, createClientCertHttp } from "./client-cert-http.js";

const nowMs = Date.now();
const live = () => new AbortController().signal;
const authority = makeTestCertificate({ name: "service authority", nowMs, isAuthority: true });
const serverCert = makeTestCertificate({
  name: "service",
  nowMs,
  ipAddresses: ["127.0.0.1"],
  issuer: authority,
});
const worker = makeTestCertificate({
  name: "worker",
  nowMs,
  uris: ["spiffe://binference.io/worker/w-1"],
  issuer: authority,
});
const stranger = makeTestCertificate({ name: "stranger", nowMs, isAuthority: true });

function httpOf(client: TestCertificate, ca: string = authority.cert): ClientCertHttp {
  return createClientCertHttp({
    certificate: { cert: client.cert, key: createSecret(client.key), ca },
    userAgent: "binference/test",
    maxAnswerBytes: 1_024,
  });
}

// The URI name of the certificate the connection's client presented.
function presented(socket: TLSSocket): string {
  return socket.getPeerCertificate().subjectaltname ?? "";
}

describe("an Http that presents a client certificate", () => {
  let server: Server;
  let origin = "";
  const seen: string[] = [];
  const opened: ClientCertHttp[] = [];

  beforeAll(async () => {
    server = createServer(
      {
        cert: serverCert.cert,
        key: serverCert.key,
        ca: authority.cert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (incoming, outgoing) => {
        seen.push(incoming.url ?? "");
        const answers: Record<string, readonly [number, string]> = {
          "/ok": [200, "ok"],
          "/who": [200, presented(incoming.socket as TLSSocket)],
          "/big": [200, "x".repeat(2_048)],
        };
        const [status, body] = answers[incoming.url ?? ""] ?? [404, "missing"];
        outgoing.writeHead(status, { "content-type": "text/plain" }).end(body);
      },
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    origin = `https://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
  });

  afterAll(async () => {
    await Promise.all(opened.map(async (http) => http.close()));
    server.closeAllConnections();
    server.close();
  });

  const open = (client: TestCertificate, ca?: string): ClientCertHttp => {
    const http = httpOf(client, ca);
    opened.push(http);
    return http;
  };

  it.each(
    httpContract({
      create: () => ({
        http: open(worker),
        okUrl: `${origin}/ok`,
        missingUrl: `${origin}/missing`,
        unreachableUrl: "https://127.0.0.1:1/ok",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("presents its certificate, so the server reads the worker it names", async () => {
    const answer = await open(worker).request({
      method: "GET",
      url: `${origin}/who`,
      signal: live(),
    });
    expect(answer.body).toBe("URI:spiffe://binference.io/worker/w-1");
  });

  it("gets no answer with a certificate the server's authority did not sign", async () => {
    const before = seen.length;
    const asking = open(stranger).request({ method: "GET", url: `${origin}/ok`, signal: live() });
    await expect(asking).rejects.toMatchObject({ code: "http.unreachable", retryable: true });
    expect(seen.length).toBe(before);
  });

  it("refuses a server its own authority did not sign", async () => {
    const asking = open(worker, stranger.cert).request({
      method: "GET",
      url: `${origin}/ok`,
      signal: live(),
    });
    await expect(asking).rejects.toBeInstanceOf(BinferenceError);
  });

  it("refuses an answer past its most bytes, and a request that is not https", async () => {
    const http = open(worker);
    await expect(
      http.request({ method: "GET", url: `${origin}/big`, signal: live() }),
    ).rejects.toMatchObject({ code: "http.answer_too_large" });
    await expect(
      http.request({ method: "GET", url: "http://127.0.0.1:1/ok", signal: live() }),
    ).rejects.toMatchObject({ code: "http.not_https" });
  });
});
