import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** A certificate and its private key, both in PEM, for a TLS server a test runs. */
export interface SmokeCertificate {
  readonly cert: string;
  readonly key: string;
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

function extensions(hosts: readonly string[]): Buffer {
  const critical = der(0x01, Buffer.from([0xff]));
  // A CA that is its own leaf, as `openssl req -x509` makes one, trusted through
  // NODE_EXTRA_CA_CERTS by the processes under test.
  const basic = sequence(oid("2.5.29.19"), critical, der(0x04, sequence(critical)));
  const names = hosts.map((host) => der(0x82, Buffer.from(host, "ascii")));
  const altNames = sequence(oid("2.5.29.17"), der(0x04, sequence(...names)));
  return der(0xa3, sequence(basic, altNames));
}

function pem(label: string, body: Buffer): string {
  const lines = body.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Makes a self-signed P-256 certificate for the host names, valid from an hour before `nowMs` for
 * a day, with Node's crypto alone, so a test serves TLS on every OS without openssl. It is a CA
 * that is its own leaf: a process that trusts it through `NODE_EXTRA_CA_CERTS` accepts it for
 * those names.
 */
export function makeSmokeCertificate(hosts: readonly string[], nowMs: number): SmokeCertificate {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaSha256 = sequence(oid("1.2.840.10045.4.3.2"));
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const name = commonName("binference packed-install smoke");
  const hour = 3_600_000;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ecdsaSha256,
    name,
    sequence(utcTime(nowMs - hour), utcTime(nowMs + 24 * hour)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions(hosts),
  );
  const signature = der(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)]));
  return {
    cert: pem("CERTIFICATE", sequence(tbs, ecdsaSha256, signature)),
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
