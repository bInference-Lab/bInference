import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** A certificate, its private key, both in PEM, and the common name it was made for. */
export interface TestCertificate {
  readonly cert: string;
  readonly key: string;
  readonly name: string;
}

/** What {@link makeTestCertificate} makes. */
export interface TestCertificateRequest {
  /** The subject's common name. */
  readonly name: string;
  /** The moment it holds around: from an hour before for a day. */
  readonly nowMs: number;
  /** Whether it may sign other certificates; a leaf when absent. */
  readonly isAuthority?: boolean;
  readonly dnsNames?: readonly string[];
  /** IPv4 addresses, dotted. */
  readonly ipAddresses?: readonly string[];
  readonly uris?: readonly string[];
  /** The authority that signs it; it signs itself when absent. */
  readonly issuer?: TestCertificate;
}

// The few DER encodings an X.509 certificate needs (ITU-T X.690): a tag, then the length.
function der(tag: number, content: Buffer): Buffer {
  const { length } = content;
  if (length < 0x80) {
    return Buffer.concat([Buffer.from([tag, length]), content]);
  }
  const size = Buffer.from(length.toString(16).padStart(length > 0xff ? 4 : 2, "0"), "hex");
  return Buffer.concat([Buffer.from([tag, 0x80 | size.length]), size, content]);
}

const sequence = (...items: readonly Buffer[]): Buffer => der(0x30, Buffer.concat(items));

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const arcs = rest.map((arc) => {
    const bytes = [arc & 0x7f];
    for (let left = arc >>> 7; left > 0; left >>>= 7) {
      bytes.unshift(0x80 | (left & 0x7f));
    }
    return Buffer.from(bytes);
  });
  return der(0x06, Buffer.concat([Buffer.from([first * 40 + second]), ...arcs]));
}

// UTCTime: YYMMDDHHMMSSZ.
function utcTime(ms: number): Buffer {
  const text = new Date(ms).toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return der(0x17, Buffer.from(`${text}Z`, "ascii"));
}

const commonName = (name: string): Buffer =>
  sequence(der(0x31, sequence(oid("2.5.4.3"), der(0x0c, Buffer.from(name, "utf8")))));

// The subject's other names: DNS names (tag 2), URIs (tag 6) and IPv4 addresses (tag 7).
function altNames(request: TestCertificateRequest): readonly Buffer[] {
  const dns = (request.dnsNames ?? []).map((name) => der(0x82, Buffer.from(name, "ascii")));
  const uris = (request.uris ?? []).map((uri) => der(0x86, Buffer.from(uri, "ascii")));
  const ips = (request.ipAddresses ?? []).map((ip) =>
    der(0x87, Buffer.from(ip.split(".").map(Number))),
  );
  return [...dns, ...uris, ...ips];
}

function extensions(request: TestCertificateRequest): Buffer {
  const critical = der(0x01, Buffer.from([0xff]));
  const isAuthority = request.isAuthority === true ? [critical] : [];
  const basic = sequence(oid("2.5.29.19"), critical, der(0x04, sequence(...isAuthority)));
  const names = altNames(request);
  const alt = names.length === 0 ? [] : [sequence(oid("2.5.29.17"), der(0x04, sequence(...names)))];
  return der(0xa3, sequence(basic, ...alt));
}

function pem(label: string, body: Buffer): string {
  const lines = body.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Makes a P-256 X.509 certificate with Node's crypto alone, so a test serves and checks TLS on
 * every OS without openssl: a leaf or an authority, signed by `issuer` or by itself, naming the
 * DNS names, IPv4 addresses and URIs asked. Nothing in production uses it.
 */
export function makeTestCertificate(request: TestCertificateRequest): TestCertificate {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaSha256 = sequence(oid("1.2.840.10045.4.3.2"));
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const { issuer, nowMs } = request;
  const hour = 3_600_000;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ecdsaSha256,
    commonName(issuer?.name ?? request.name),
    sequence(utcTime(nowMs - hour), utcTime(nowMs + 24 * hour)),
    commonName(request.name),
    publicKey.export({ type: "spki", format: "der" }),
    extensions(request),
  );
  const signer = issuer === undefined ? privateKey : createPrivateKey(issuer.key);
  const signature = der(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, signer)]));
  return {
    cert: pem("CERTIFICATE", sequence(tbs, ecdsaSha256, signature)),
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    name: request.name,
  };
}
