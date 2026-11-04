import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- tests serve a registry of their own on loopback
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { sha512Integrity } from "../skills/fetch-skill.js";

/** One file of a package a test publishes: its path inside `package/` and its text. */
interface PublishedFile {
  readonly path: string;
  readonly text: string;
}

/** A version a test publishes on the fake registry. */
interface PublishedVersion {
  readonly name: string;
  readonly version: string;
  /** Its files besides `package.json`, which the registry writes from `manifest`. */
  readonly files: readonly PublishedFile[];
  readonly manifest: CommunityManifest;
  /** Names a provenance attestation the registry does not hold, so its check fails. */
  readonly claimsProvenance?: boolean;
  /** Extra tar entries as they are, such as a link, placed after the files. */
  readonly extraEntries?: readonly Uint8Array[];
}

/** npm's registry as a test stands it up on loopback: versions, tarballs and statuses. */
export interface FakeNpmRegistry {
  /** The registry's origin, such as `http://127.0.0.1:41234`. */
  readonly base: string;
  /** Publishes a version and answers its npm integrity. */
  publish(version: PublishedVersion): string;
  /** Answers every request with this status from now on, such as 429 or 503. */
  answerAll(status: number, headers?: Readonly<Record<string, string>>): void;
  /** The paths it was asked for, in order. */
  requests(): readonly string[];
  close(): Promise<void>;
}

const encoder = new TextEncoder();

// A header's checksum as tar writers write it: six octal digits, a NUL and a space.
function signHeader(header: Uint8Array): void {
  header.fill(0x20, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\u0000 `), 148);
}

/** One ustar entry: its header, then its body padded to whole blocks. */
export function tarEntry(entry: {
  readonly name: string;
  readonly text?: string;
  readonly type?: string;
  readonly link?: string;
}): Uint8Array {
  const body = encoder.encode(entry.text ?? "");
  const header = new Uint8Array(512);
  header.set(encoder.encode(entry.name), 0);
  header.set(encoder.encode("0000644\0"), 100);
  header.set(encoder.encode(`${body.length.toString(8).padStart(11, "0")}\0`), 124);
  header.set(encoder.encode(entry.type ?? "0"), 156);
  header.set(encoder.encode(entry.link ?? ""), 157);
  header.set(encoder.encode("ustar\u000000"), 257);
  signHeader(header);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  return new Uint8Array(Buffer.concat([header, padded]));
}

function tarballOf(version: PublishedVersion): Uint8Array {
  const packageJson = JSON.stringify({
    name: version.name,
    version: version.version,
    binference: version.manifest,
  });
  const entries = [
    tarEntry({ name: "package/package.json", text: packageJson }),
    ...version.files.map(({ path, text }) => tarEntry({ name: `package/${path}`, text })),
    ...(version.extraEntries ?? []),
  ];
  return new Uint8Array(gzipSync(Buffer.concat([...entries, new Uint8Array(1024)])));
}

interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

const json = (value: object): Answer => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: encoder.encode(JSON.stringify(value)),
});

const notFound: Answer = {
  status: 404,
  headers: {},
  body: encoder.encode('{"error":"Not found"}'),
};

// The document of a published version: its integrity, its tarball on the registry's own origin,
// and, for a version that claims provenance, an attestation the registry does not hold.
function documentOf(
  version: PublishedVersion,
  at: { readonly base: string; readonly tarball: string; readonly integrity: string },
) {
  const attestations =
    version.claimsProvenance === true
      ? {
          attestations: {
            url: `${at.base}/elsewhere`,
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
        }
      : {};
  return {
    name: version.name,
    version: version.version,
    dist: { integrity: at.integrity, tarball: `${at.base}${at.tarball}`, ...attestations },
    _npmUser: { name: "fake-publisher" },
  };
}

async function listen(server: Server): Promise<string> {
  server.listen({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * Stands up npm's registry on loopback for a test, as its docs and answers describe it:
 * `GET /<name>/<version>` with `dist.integrity`, `dist.tarball` on its own origin and, for a
 * version that claims one, `dist.attestations`; the tarball; and a 404 for anything else. No
 * test installs a real package.
 */
export async function startFakeNpmRegistry(): Promise<FakeNpmRegistry> {
  const routes = new Map<string, Answer>();
  const asked: string[] = [];
  const forced: { answer: Answer | undefined } = { answer: undefined };
  const server: Server = createServer((request, response) => {
    const path = request.url ?? "/";
    asked.push(path);
    const answer = forced.answer ?? routes.get(path) ?? notFound;
    response.writeHead(answer.status, answer.headers);
    response.end(answer.body);
  });
  const base = await listen(server);
  return {
    base,
    publish(version) {
      const tarball = tarballOf(version);
      const integrity = sha512Integrity(tarball);
      const file = `${version.name.split("/").at(-1) ?? version.name}-${version.version}.tgz`;
      const tarballPath = `/${version.name}/-/${file}`;
      const document = documentOf(version, { base, tarball: tarballPath, integrity });
      routes.set(`/${version.name.replace("/", "%2f")}/${version.version}`, json(document));
      routes.set(tarballPath, { status: 200, headers: {}, body: tarball });
      return integrity;
    },
    answerAll(status, headers = {}) {
      forced.answer = { status, headers, body: new Uint8Array() };
    },
    requests: () => [...asked],
    close: async () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
