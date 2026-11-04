import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { connect, createServer } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { makeSmokeCertificate } from "./smoke-certificate.js";

const hosts = ["api.privy.io", "api.telegram.org"];
const nowMs = Date.UTC(2026, 10, 4, 12);
const closers: (() => void)[] = [];

afterEach(() => {
  closers.splice(0).forEach((close) => close());
});

// Opens a TLS connection to a server that serves the certificate, trusting only that
// certificate, and answers whether the handshake verified the name. TLS checks the validity
// against the machine's clock, so the certificate starts from it.
async function handshake(servername: string): Promise<string> {
  const made = makeSmokeCertificate(hosts, Date.now());
  const server = createServer({ cert: made.cert, key: made.key }, (socket) => socket.end("ok"));
  closers.push(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const socket = connect({ host: "127.0.0.1", port, servername, ca: made.cert });
  closers.push(() => socket.destroy());
  // `once` rejects with the socket's error, such as a name the certificate does not hold.
  return once(socket, "secureConnect").then(
    () => "verified",
    (error: unknown) => (error instanceof Error && "code" in error ? String(error.code) : "failed"),
  );
}

describe("the packed-install smoke's certificate", () => {
  it("names each host, signs itself and holds a day from an hour before now", () => {
    const made = makeSmokeCertificate(hosts, nowMs);
    const cert = new X509Certificate(made.cert);
    expect(cert.subjectAltName).toBe("DNS:api.privy.io, DNS:api.telegram.org");
    expect(cert.ca).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkHost("api.telegram.org")).toBe("api.telegram.org");
    expect(cert.checkHost("api.openai.com")).toBeUndefined();
    expect(cert.validFromDate.getTime()).toBe(nowMs - 3_600_000);
    expect(cert.validToDate.getTime()).toBe(nowMs + 86_400_000);
    expect(made.key).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
  });

  it("serves TLS that a client trusting it accepts for its names and refuses for others", async () => {
    await expect(handshake("api.privy.io")).resolves.toBe("verified");
    await expect(handshake("api.openai.com")).resolves.toBe("ERR_TLS_CERT_ALTNAME_INVALID");
  });
});
