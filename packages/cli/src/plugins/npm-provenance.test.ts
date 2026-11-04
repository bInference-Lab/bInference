// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads its recorded answers
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type JsonValue, jsonValueSchema, ok } from "@binference/core";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type BundleVerifier,
  checkProvenance,
  packageUrlOf,
  publisherOf,
  type SignerIdentity,
} from "./npm-provenance.js";
import type { NpmAttestation, NpmRegistry, NpmVersion } from "./npm-registry.js";
import { failed } from "./outcome.js";
import { sigstoreVerifier } from "./sigstore-verifier.js";

// What npm's registry answered on 2026-11-04 for sigstore@5.0.0, built by its own repository's
// workflow, and @fastify/cors@11.4.0, built by a reusable workflow of another repository: each
// version's document and its attestations, provenance and publish. No tarball is ever read.
const recordedSchema = z.object({
  version: z.object({
    name: z.string(),
    version: z.string(),
    dist: z.object({ integrity: z.string(), tarball: z.string() }),
    _npmUser: z.object({ name: z.string() }),
  }),
  attestations: z.object({
    attestations: z.array(z.object({ predicateType: z.string(), bundle: jsonValueSchema })),
  }),
});

type Recorded = z.infer<typeof recordedSchema>;
let recorded: Recorded;
let reusable: Recorded;
const signal = AbortSignal.timeout(60_000);

async function readRecorded(file: string): Promise<Recorded> {
  const text = await readFile(join(import.meta.dirname, "recorded", file), "utf8");
  return recordedSchema.parse(JSON.parse(text));
}

beforeAll(async () => {
  recorded = await readRecorded("sigstore-5.0.0.json");
  reusable = await readRecorded("fastify-cors-11.4.0.json");
});

const github = "https://token.actions.githubusercontent.com";

const provenanceType = "https://slsa.dev/provenance/v1";

const signerSchema: z.ZodType<SignerIdentity> = z.object({
  signedBy: z.string(),
  issuer: z.string().exactOptional(),
  sourceRepository: z.string().exactOptional(),
});

function versionOf(change: Partial<NpmVersion> = {}, from: Recorded = recorded): NpmVersion {
  const { name, version, dist } = from.version;
  return {
    name,
    version,
    integrity: dist.integrity,
    tarball: dist.tarball,
    provenanceType,
    ...change,
  };
}

// The registry's attestations only: the provenance check reads nothing else.
function registryOf(attestations: readonly NpmAttestation[]): NpmRegistry {
  return {
    version: async () => failed({ reason: "not_published" }),
    tarball: async () => failed({ reason: "not_published" }),
    attestations: async () => ok(attestations),
  };
}

const recordedAttestations = (): readonly NpmAttestation[] => recorded.attestations.attestations;

// The provenance attestation's bundle with its statement's subject digest replaced.
function withSubjectDigest(attestation: NpmAttestation | undefined, digest: Buffer): JsonValue {
  const sha512 = digest.toString("hex");
  const bundle = attestation?.bundle ?? null;
  const parsed = z
    .object({ dsseEnvelope: z.object({ payload: z.string() }).loose() })
    .loose()
    .parse(bundle);
  const statement = z
    .object({ subject: z.array(z.object({ name: z.string() })) })
    .loose()
    .parse(JSON.parse(Buffer.from(parsed.dsseEnvelope.payload, "base64").toString("utf8")));
  const subject = [{ ...statement.subject[0], digest: { sha512 } }];
  const payload = Buffer.from(JSON.stringify({ ...statement, subject })).toString("base64");
  return jsonValueSchema.parse({ ...parsed, dsseEnvelope: { ...parsed.dsseEnvelope, payload } });
}

// A verifier that passes every bundle as signed by `identity`.
const signedAs =
  (identity: SignerIdentity): BundleVerifier =>
  async () =>
    ok(identity);
const passAll = signedAs({
  signedBy: "https://github.com/example/feed/.github/workflows/release.yml@refs/heads/main",
  issuer: github,
  sourceRepository: "https://github.com/example/feed",
});

describe("npm provenance", () => {
  it("verifies a recorded provenance bundle offline and names its source repository", async () => {
    const parts = { registry: registryOf(recordedAttestations()), verify: sigstoreVerifier() };

    await expect(checkProvenance(parts, versionOf(), signal)).resolves.toStrictEqual({
      ok: true,
      value: {
        provenance: "verified",
        publisher: "github.com/sigstore/sigstore-js",
        issuer: github,
      },
    });
  });

  it("names the source repository of a build that ran another repository's workflow", async () => {
    const attestations = reusable.attestations.attestations;
    const parts = { registry: registryOf(attestations), verify: sigstoreVerifier() };

    await expect(checkProvenance(parts, versionOf({}, reusable), signal)).resolves.toStrictEqual({
      ok: true,
      value: {
        provenance: "verified",
        publisher: "github.com/fastify/fastify-cors",
        issuer: github,
        workflow: "github.com/fastify/workflows/.github/workflows/reusable-release.yml",
      },
    });
  });

  it.each([
    [
      "an issuer that is neither GitHub Actions nor GitLab",
      { issuer: "https://accounts.google.com" },
    ],
    ["no issuer", { issuer: undefined }],
    ["no source repository", { sourceRepository: undefined }],
  ] as const)("refuses a bundle signed with %s", async (_case, change) => {
    const identity = {
      signedBy: "https://github.com/example/feed/.github/workflows/release.yml@refs/heads/main",
      issuer: github,
      sourceRepository: "https://github.com/example/feed",
    };
    const signer = Object.fromEntries(
      Object.entries({ ...identity, ...change }).filter(([, value]) => value !== undefined),
    );
    const verify = signedAs(signerSchema.parse(signer));
    const parts = { registry: registryOf(recordedAttestations()), verify };

    await expect(checkProvenance(parts, versionOf(), signal)).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "provenance_failed" },
    });
  });

  it("refuses the recorded bundle for a tarball of another digest", async () => {
    const parts = { registry: registryOf(recordedAttestations()), verify: sigstoreVerifier() };
    const other = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

    await expect(
      checkProvenance(parts, versionOf({ integrity: other }), signal),
    ).resolves.toStrictEqual({ ok: false, failure: { reason: "provenance_failed" } });
  });

  it("refuses a statement changed to name another digest, which no signature covers", async () => {
    const other = Buffer.alloc(64, 7);
    const [, provenance] = recordedAttestations();
    const forged = { predicateType: provenanceType, bundle: withSubjectDigest(provenance, other) };
    const parts = { registry: registryOf([forged]), verify: sigstoreVerifier() };
    const version = versionOf({ integrity: `sha512-${other.toString("base64")}` });

    await expect(checkProvenance(parts, version, signal)).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "provenance_failed" },
    });
  });

  it("reads a version whose document names no provenance as none, reading nothing more", async () => {
    const parts = { registry: registryOf([]), verify: passAll };
    const { provenanceType: _named, ...none } = versionOf();

    await expect(checkProvenance(parts, none, signal)).resolves.toStrictEqual({
      ok: true,
      value: { provenance: "none" },
    });
  });

  it.each([
    ["names provenance the registry does not hold", []],
    [
      "holds two provenance attestations",
      [
        { predicateType: provenanceType, bundle: null },
        { predicateType: provenanceType, bundle: null },
      ],
    ],
  ] as const)("refuses a version that %s", async (_case, attestations) => {
    const parts = { registry: registryOf(attestations), verify: passAll };

    await expect(checkProvenance(parts, versionOf(), signal)).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "provenance_failed" },
    });
  });

  it("names a scoped package's URL with its at sign escaped", () => {
    expect(packageUrlOf("@sigstore/verify", "4.1.2")).toBe("pkg:npm/%40sigstore/verify@4.1.2");
    expect(packageUrlOf("fear-index", "1.2.0")).toBe("pkg:npm/fear-index@1.2.0");
  });

  it("names a GitLab project's own pipeline without a second workflow line", () => {
    const identity = {
      signedBy: "https://gitlab.com/group/project//.gitlab-ci.yml@refs/tags/v1",
      issuer: "https://gitlab.com",
      sourceRepository: "https://gitlab.com/group/project",
    };

    expect(publisherOf(identity)).toStrictEqual({
      publisher: "gitlab.com/group/project",
      issuer: "https://gitlab.com",
    });
  });
});
