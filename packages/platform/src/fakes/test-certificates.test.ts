import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { connect, createServer } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestCertificate, type TestCertificate } from "./test-certificates.js";

const hosts = ["api.privy.io", "api.telegram.org"];
const nowMs = Date.UTC(2026, 10, 4, 12);
const closers: (() => void)[] = [];

afterEach(() => {
  closers.splice(0).forEach((close) => close());
});

// A self-signed authority that is its own leaf for the hosts, as the packed-install smoke serves.
function selfSigned(atMs: number): TestCertificate {
  return makeTestCertificate({ name: "smoke", nowMs: atMs, isAuthority: true, dnsNames: hosts });
}

// Opens a TLS connection to a server that serves the certificate, trusting only `ca`, and answers
// whether the handshake verified the name. TLS checks the validity against the machine's clock, so
// the certificates start from it.
async function handshake(
  served: TestCertificate,
  trust: { readonly ca: string; readonly servername: string },
): Promise<string> {
  const server = createServer({ cert: served.cert, key: served.key }, (socket) => socket.end("ok"));
  closers.push(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const socket = connect({ host: "127.0.0.1", port, servername: trust.servername, ca: trust.ca });
  closers.push(() => socket.destroy());
  // `once` rejects with the socket's error, such as a name the certificate does not hold.
  return once(socket, "secureConnect").then(
    () => "verified",
    (error: unknown) => (error instanceof Error && "code" in error ? String(error.code) : "failed"),
  );
}

describe("a test certificate", () => {
  it("names each host, signs itself and holds a day from an hour before now", () => {
    const made = selfSigned(nowMs);
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

  it("issues a leaf its authority signed, naming an address and a URI", () => {
    const authority = makeTestCertificate({ name: "test authority", nowMs, isAuthority: true });
    const leaf = makeTestCertificate({
      name: "worker",
      nowMs,
      ipAddresses: ["127.0.0.1"],
      uris: ["spiffe://binference.io/worker/w-1"],
      issuer: authority,
    });
    const cert = new X509Certificate(leaf.cert);
    expect(cert.ca).toBe(false);
    expect(cert.issuer).toBe("CN=test authority");
    expect(cert.subjectAltName).toBe("URI:spiffe://binference.io/worker/w-1, IP Address:127.0.0.1");
    expect(cert.verify(new X509Certificate(authority.cert).publicKey)).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(false);
  });

  it("serves TLS that a client trusting it accepts for its names and refuses for others", async () => {
    const made = selfSigned(Date.now());
    const ca = made.cert;
    await expect(handshake(made, { ca, servername: "api.privy.io" })).resolves.toBe("verified");
    await expect(handshake(made, { ca, servername: "api.openai.com" })).resolves.toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
  });

  it("serves a leaf that a client trusting only its authority accepts", async () => {
    const authority = makeTestCertificate({
      name: "authority",
      nowMs: Date.now(),
      isAuthority: true,
    });
    const leaf = makeTestCertificate({
      name: "server",
      nowMs: Date.now(),
      dnsNames: ["localhost"],
      issuer: authority,
    });
    const trust = { ca: authority.cert, servername: "localhost" };
    await expect(handshake(leaf, trust)).resolves.toBe("verified");
  });
});
