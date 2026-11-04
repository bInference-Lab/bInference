import { type JsonValue, jsonValueSchema, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { NpmAttestation, NpmRegistry, NpmVersion, RegistryFailure } from "./npm-registry.js";
import { failed, type Outcome } from "./outcome.js";

/** The predicate type of npm's provenance attestation (SLSA provenance v1). */
const provenanceType = "https://slsa.dev/provenance/v1";
const inTotoPayload = "application/vnd.in-toto+json";
const statementType = "https://in-toto.io/Statement/v1";

/**
 * What a verified signing certificate names: its subject alternative name (for a CI build, the
 * workflow that ran it), its OIDC issuer, and its Source Repository URI extension (Fulcio OID
 * 1.3.6.1.4.1.57264.1.12), the repository the build checked out.
 */
export interface SignerIdentity {
  readonly signedBy: string;
  readonly issuer?: string;
  readonly sourceRepository?: string;
}

/**
 * Checks one Sigstore bundle's signatures, certificate and transparency log entry; answers what
 * its signing certificate names, or `unverified`. Adapters: `sigstoreVerifier`, and a test's own.
 */
export type BundleVerifier = (
  bundle: JsonValue,
  signal: AbortSignal,
) => Promise<Result<SignerIdentity, "unverified">>;

/**
 * What npm provenance says of a version: verified, with the source repository and the issuer its
 * certificate names, and the build workflow when that lives in another repository; or none.
 */
export type ProvenanceOutcome =
  | {
      readonly provenance: "verified";
      readonly publisher: string;
      readonly issuer: string;
      readonly workflow?: string;
    }
  | { readonly provenance: "none" };

/** Why a version's provenance did not check out, or the registry failure that kept it unread. */
export type ProvenanceFailure = { readonly reason: "provenance_failed" } | RegistryFailure;

const statementSchema = z.object({
  _type: z.literal(statementType),
  predicateType: z.literal(provenanceType),
  subject: z
    .array(z.object({ name: z.string(), digest: z.object({ sha512: z.string() }) }))
    .length(1),
});

const envelopeSchema = z.object({
  dsseEnvelope: z.object({ payloadType: z.literal(inTotoPayload), payload: z.base64() }),
});

/** The package URL npm signs a version under: `pkg:npm/<name>@<version>`, a scope's `@` as `%40`. */
export function packageUrlOf(name: string, version: string): string {
  return `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;
}

/** The hex SHA-512 of an npm integrity, `sha512-` and its base64 digest. */
function integrityHex(integrity: string): string {
  return Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex");
}

function jsonOf(text: string): JsonValue | undefined {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Whether the bundle's statement names exactly this version and its tarball's digest.
function namesVersion(bundle: JsonValue, version: NpmVersion): boolean {
  const envelope = envelopeSchema.safeParse(bundle);
  if (!envelope.success) {
    return false;
  }
  const payload = Buffer.from(envelope.data.dsseEnvelope.payload, "base64").toString("utf8");
  const statement = statementSchema.safeParse(jsonOf(payload));
  const subject = statement.success ? statement.data.subject[0] : undefined;
  return (
    subject?.name === packageUrlOf(version.name, version.version) &&
    subject.digest.sha512 === integrityHex(version.integrity)
  );
}

/**
 * The CI services whose builds npm provenance can come from, by their OIDC issuer: GitHub Actions
 * and GitLab CI/CD, as npm's provenance documentation lists them. Any other issuer is refused.
 */
const acceptedIssuers: ReadonlySet<string> = new Set([
  "https://token.actions.githubusercontent.com",
  "https://gitlab.com",
]);

// A name a review shows whole: at most this many characters.
const maxNameLength = 200;

const withoutScheme = (url: string): string => url.replace(/^https:\/\//, "");

// The repository a workflow identity lives in: GitHub's `<repo>/.github/workflows/<file>@<ref>`
// or GitLab's `<project>//<file>@<ref>`.
function workflowRepository(workflow: string): string {
  const github = workflow.indexOf("/.github/workflows/");
  const gitlab = workflow.indexOf("//");
  const end = github >= 0 ? github : gitlab;
  return end >= 0 ? workflow.slice(0, end) : workflow;
}

/**
 * What the review shows of a verified signer (decision 0348): its source repository from the
 * Source Repository URI extension, without `https://`, and the build workflow from the subject
 * alternative name, without its ref, only when it lives in another repository; none when the
 * issuer is neither GitHub Actions nor GitLab, the extension is missing, or a name is too long to
 * show whole.
 */
export function publisherOf(
  identity: SignerIdentity,
): { readonly publisher: string; readonly issuer: string; readonly workflow?: string } | undefined {
  const { issuer, sourceRepository } = identity;
  if (issuer === undefined || !acceptedIssuers.has(issuer) || sourceRepository === undefined) {
    return undefined;
  }
  const publisher = withoutScheme(sourceRepository);
  const workflow = withoutScheme(identity.signedBy).replace(/@[^@]*$/, "");
  const apart = workflowRepository(workflow) !== publisher;
  const fits = publisher.length <= maxNameLength && workflow.length <= maxNameLength;
  return fits ? { publisher, issuer, ...(apart ? { workflow } : {}) } : undefined;
}

function provenanceOf(attestations: readonly NpmAttestation[]): NpmAttestation | undefined {
  const matching = attestations.filter(({ predicateType }) => predicateType === provenanceType);
  return matching.length === 1 ? matching[0] : undefined;
}

/**
 * Checks a version's npm provenance as npm's own fetcher does (decision 0348): a version whose
 * document names no provenance attestation of SLSA provenance v1 has none; one that does must
 * have exactly one such attestation at the registry, its DSSE envelope of in-toto JSON naming one
 * subject, the version's package URL with its tarball's SHA-512, and its bundle must verify,
 * signed by GitHub Actions or GitLab with the source repository named. Any other answer is
 * `provenance_failed`: a broken attestation never reads as none.
 */
export async function checkProvenance(
  parts: { readonly registry: NpmRegistry; readonly verify: BundleVerifier },
  version: NpmVersion,
  signal: AbortSignal,
): Promise<Outcome<ProvenanceOutcome, ProvenanceFailure>> {
  if (version.provenanceType === undefined) {
    return ok({ provenance: "none" });
  }
  if (version.provenanceType !== provenanceType) {
    return failed({ reason: "provenance_failed" });
  }
  const read = await parts.registry.attestations(version.name, version.version, signal);
  if (!read.ok) {
    // Attestations the document names and the registry does not hold are a broken claim.
    return read.failure.reason === "not_published" ? failed({ reason: "provenance_failed" }) : read;
  }
  const attestation = provenanceOf(read.value);
  if (attestation === undefined || !namesVersion(attestation.bundle, version)) {
    return failed({ reason: "provenance_failed" });
  }
  const verified = await parts.verify(attestation.bundle, signal);
  const named = verified.ok ? publisherOf(verified.value) : undefined;
  return named === undefined
    ? failed({ reason: "provenance_failed" })
    : ok({ provenance: "verified", ...named });
}
