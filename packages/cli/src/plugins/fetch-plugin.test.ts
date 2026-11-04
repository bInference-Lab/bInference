import { ok } from "@binference/core";
import { digestOfFiles } from "@binference/plugin-host";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { type FakeNpmRegistry, startFakeNpmRegistry, tarEntry } from "./fake-npm-registry.js";
import { fetchPlugin, type PluginSource, readPluginSource } from "./fetch-plugin.js";
import type { BundleVerifier } from "./npm-provenance.js";
import { createNpmRegistry } from "./npm-registry.js";

let registry: FakeNpmRegistry;
let http: SystemHttp;
const signal = AbortSignal.timeout(60_000);

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
});

afterAll(async () => {
  await http.close();
});

afterEach(async () => {
  await registry.close();
});

const manifest: CommunityManifest = {
  api: 1,
  id: "fear-index",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [
    {
      name: "index",
      description: "Reads the index.",
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object" },
    },
  ],
};

const encoded = (text: string): Uint8Array => new TextEncoder().encode(text);
const packageJson = {
  path: "package.json",
  bytes: encoded(JSON.stringify({ name: "fear-index", version: "1.2.0", binference: manifest })),
};

const index = { path: "index.mjs", text: "export const tools = { index: async () => ({}) };\n" };

// A pax record naming the next entry's path, as tar writers count it.
function paxPath(path: string): string {
  const record = ` path=${path}\n`;
  return `${String(record.length + String(record.length + 3).length)}${record}`;
}
const neverVerified: BundleVerifier = async () => ok({ signedBy: "https://example.com/" });

function sourceOf(integrity: string): PluginSource {
  const source = readPluginSource("npm:fear-index@1.2.0", integrity);
  if (!source.ok) {
    throw new Error("The test's source does not read.");
  }
  return source.value;
}

function partsOf(stood: FakeNpmRegistry) {
  return {
    registry: createNpmRegistry({ download: http, base: stood.base }),
    verify: neverVerified,
  };
}

async function fetched(
  version: Partial<Parameters<FakeNpmRegistry["publish"]>[0]> = {},
  asked: { readonly hash?: string } = {},
) {
  registry = await startFakeNpmRegistry();
  const integrity = registry.publish({
    name: "fear-index",
    version: "1.2.0",
    files: [index],
    manifest,
    ...version,
  });
  return fetchPlugin(partsOf(registry), sourceOf(asked.hash ?? integrity), signal);
}

describe("fetching a community plugin from npm", () => {
  it("reads a version with no provenance, its files pinned and the registry's publisher named", async () => {
    const plugin = await fetched();

    expect(plugin).toMatchObject({
      ok: true,
      value: {
        provenance: { provenance: "none" },
        registryPublisher: "fake-publisher",
        pkg: {
          manifest,
          filesHash: digestOfFiles([
            { path: "index.mjs", bytes: encoded(index.text) },
            packageJson,
          ]),
        },
      },
    });
    expect(registry.requests()).toStrictEqual([
      "/fear-index/1.2.0",
      "/fear-index/-/fear-index-1.2.0.tgz",
    ]);
  });

  it("refuses a version whose integrity is not the one asked for, before its tarball", async () => {
    const other = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

    await expect(fetched({}, { hash: other })).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.hash_mismatch" },
    });
    expect(registry.requests()).toStrictEqual(["/fear-index/1.2.0"]);
  });

  it("refuses a version that names provenance the registry does not serve", async () => {
    await expect(fetched({ claimsProvenance: true })).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.provenance_failed" },
    });
  });

  it.each([
    ["a symbolic link", tarEntry({ name: "package/secret", type: "2", link: "/etc/passwd" })],
    ["a hard link", tarEntry({ name: "package/copy.mjs", type: "1", link: "package/index.mjs" })],
    ["a path that climbs out", tarEntry({ name: "package/../outside.mjs", text: "x" })],
    ["a file outside package/", tarEntry({ name: "other/index.mjs", text: "x" })],
    ["a path twice when case is ignored", tarEntry({ name: "package/INDEX.mjs", text: "x" })],
    ["a control character", tarEntry({ name: "package/a\u0007.mjs", text: "x" })],
    ["a `.` part", tarEntry({ name: "package/./a.mjs", text: "x" })],
    ["a part ending in a dot", tarEntry({ name: "package/index.mjs.", text: "x" })],
    ["a Windows device name", tarEntry({ name: "package/nul.mjs", text: "x" })],
    ["a file that is also a folder", tarEntry({ name: "package/index.mjs/inner.mjs", text: "x" })],
    [
      "a path past 200 characters",
      new Uint8Array(
        Buffer.concat([
          tarEntry({
            name: "PaxHeader",
            type: "x",
            text: paxPath(`package/${"f".repeat(100)}/${"g".repeat(100)}.mjs`),
          }),
          tarEntry({ name: "package/short.mjs", text: "x" }),
        ]),
      ),
    ],
    ["more than 16 parts", tarEntry({ name: `package/${"d/".repeat(16)}f.mjs`, text: "x" })],
  ])("refuses a package with %s", async (_case, entry) => {
    await expect(fetched({ extraEntries: [entry] })).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.invalid" },
    });
  });

  it("refuses a package of more than 1,000 files, or more than 16 MiB", async () => {
    const many = Array.from({ length: 1_000 }, (_, n) =>
      tarEntry({ name: `package/f${String(n)}.mjs`, text: "x" }),
    );
    const big = tarEntry({ name: "package/big.bin", text: "x".repeat(16 * 1024 * 1024) });

    await expect(fetched({ extraEntries: many })).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.invalid" },
    });
    await expect(fetched({ extraEntries: [big] })).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.invalid" },
    });
  });

  it.each([
    ["the probe plugin's id", { manifest: { ...manifest, id: "sandbox-probe" } }],
    ["an entry it does not hold", { manifest: { ...manifest, entry: "dist/main.mjs" } }],
    [
      "a contract, which no community plugin may declare",
      { manifest: { ...manifest, contracts: [] } },
    ],
  ] as const)("refuses a manifest with %s", async (_case, version) => {
    await expect(fetched(version)).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.invalid" },
    });
  });

  it.each([
    [404, {}, { reason: "not_published" }],
    [429, { "retry-after": "30" }, { reason: "rate_limited", retryAfterSec: 30 }],
    [429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, { reason: "rate_limited" }],
    [503, {}, { reason: "registry_unreachable" }],
  ] as const)("answers a registry's %i as its reason", async (status, headers, failure) => {
    registry = await startFakeNpmRegistry();
    registry.answerAll(status, headers);
    const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

    await expect(
      fetchPlugin(partsOf(registry), sourceOf(integrity), signal),
    ).resolves.toStrictEqual({ ok: false, failure: { code: "plugin.fetch_failed", ...failure } });
  });
});

describe("reading a plugin's source", () => {
  it("takes an npm package at an exact version with its integrity, scoped or not", () => {
    const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

    expect(readPluginSource("npm:@fear/index@1.2.0", integrity)).toStrictEqual({
      ok: true,
      value: { name: "@fear/index", version: "1.2.0", integrity },
    });
  });

  it.each([
    ["a range", "npm:fear-index@^1.2.0"],
    ["a folder inside it", "npm:fear-index@1.2.0#dist"],
    ["git", "git:https://example.com/fear-index"],
  ])("refuses %s", (_case, source) => {
    const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

    expect(readPluginSource(source, integrity)).toStrictEqual({ ok: false, error: "bad_source" });
  });
});
