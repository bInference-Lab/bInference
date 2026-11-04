import {
  BinferenceError,
  type HttpDownload,
  type JsonValue,
  jsonValueSchema,
  ok,
} from "@binference/core";
import { z } from "zod";
import { failed, type Outcome } from "./outcome.js";

/** npm's public registry, the one place community plugins install from (decision 0348). */
export const npmRegistry = "https://registry.npmjs.org";

/**
 * Why the registry gave nothing to use: the version is not published, the registry asked to slow
 * down (with its wait in seconds when it gave one), it could not be reached or answered with a
 * status the docs do not list, or its answer did not read or was larger than an install allows.
 */
export type RegistryFailure =
  | { readonly reason: "not_published" }
  | { readonly reason: "rate_limited"; readonly retryAfterSec?: number }
  | { readonly reason: "registry_unreachable" }
  | { readonly reason: "bad_answer" };

/** One version of a package, as the registry describes it. */
export interface NpmVersion {
  readonly name: string;
  readonly version: string;
  /** `sha512-` and the base64 digest of its tarball. */
  readonly integrity: string;
  readonly tarball: string;
  /** The npm account the registry names as its publisher, by the registry's word alone. */
  readonly publisher?: string;
  /** The predicate type of its provenance attestation, when it has one. */
  readonly provenanceType?: string;
}

/** One attestation of a version: its predicate type and its Sigstore bundle, as yet unchecked. */
export interface NpmAttestation {
  readonly predicateType: string;
  readonly bundle: JsonValue;
}

/** The registry's three reads an install makes (decision 0348). */
export interface NpmRegistry {
  version(
    name: string,
    version: string,
    signal: AbortSignal,
  ): Promise<Outcome<NpmVersion, RegistryFailure>>;
  /** The tarball's bytes, at most 8 MiB; only from the registry's own origin. */
  tarball(at: NpmVersion, signal: AbortSignal): Promise<Outcome<Uint8Array, RegistryFailure>>;
  attestations(
    name: string,
    version: string,
    signal: AbortSignal,
  ): Promise<Outcome<readonly NpmAttestation[], RegistryFailure>>;
}

const mebibyte = 1024 * 1024;
const documentBound = { maxBytes: mebibyte, ms: 30_000 } as const;
const tarballBound = { maxBytes: 8 * mebibyte, ms: 60_000 } as const;

const sha512Integrity = /^sha512-[A-Za-z0-9+/]{86}==$/;

const versionSchema = z.object({
  name: z.string().min(1).max(214),
  version: z.string().min(1).max(256),
  dist: z.object({
    integrity: z.string().regex(sha512Integrity),
    tarball: z.string().max(2048),
    attestations: z
      .object({ provenance: z.object({ predicateType: z.string().max(256) }).optional() })
      .optional(),
  }),
  _npmUser: z.object({ name: z.string().max(214) }).optional(),
});

const attestationsSchema = z.object({
  attestations: z
    .array(z.object({ predicateType: z.string().max(256), bundle: jsonValueSchema }))
    .max(16),
});

// A package's name in a registry path: a scope's slash as `%2f`, as npm's own client sends it.
function pathName(name: string): string {
  return name.replace("/", "%2f");
}

// A 429 may say how long to wait, in seconds; a date or anything else is left out.
function retryAfterOf(headers: Readonly<Record<string, string>>): number | undefined {
  const value = headers["retry-after"];
  return value !== undefined && /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

function failureOf(status: number, headers: Readonly<Record<string, string>>): RegistryFailure {
  if (status === 404) {
    return { reason: "not_published" };
  }
  if (status !== 429) {
    return { reason: "registry_unreachable" };
  }
  const wait = retryAfterOf(headers);
  return wait === undefined
    ? { reason: "rate_limited" }
    : { reason: "rate_limited", retryAfterSec: wait };
}

function readJson(bytes: Uint8Array): JsonValue | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// One bounded GET: its bytes on a 200, else the failure its status or its error names.
async function getBytes(
  download: HttpDownload,
  request: { readonly url: string; readonly bound: typeof documentBound | typeof tarballBound },
  signal: AbortSignal,
): Promise<Outcome<Uint8Array, RegistryFailure>> {
  const { url, bound } = request;
  const within = AbortSignal.any([signal, AbortSignal.timeout(bound.ms)]);
  try {
    const answer = await download.download({ url, maxBytes: bound.maxBytes, signal: within });
    return answer.status === 200
      ? ok(answer.bytes)
      : failed(failureOf(answer.status, answer.headers));
  } catch (error) {
    signal.throwIfAborted();
    const tooLarge = error instanceof BinferenceError && error.code === "http.answer_too_large";
    return failed({ reason: tooLarge ? "bad_answer" : "registry_unreachable" });
  }
}

function versionOf(json: JsonValue | undefined): Outcome<NpmVersion, RegistryFailure> {
  const parsed = versionSchema.safeParse(json);
  if (!parsed.success) {
    return failed({ reason: "bad_answer" });
  }
  const { name, version, dist, _npmUser: user } = parsed.data;
  const provenanceType = dist.attestations?.provenance?.predicateType;
  return ok({
    name,
    version,
    integrity: dist.integrity,
    tarball: dist.tarball,
    ...(user === undefined ? {} : { publisher: user.name }),
    ...(provenanceType === undefined ? {} : { provenanceType }),
  });
}

/**
 * Reads npm's registry for an install (decision 0348): `GET /<name>/<version>`, the tarball the
 * answer names, which must be on the registry's own origin, and
 * `/-/npm/v1/attestations/<name>@<version>`, never the URL a document names. Each read is bounded:
 * a document 1 MiB in 30 seconds, a tarball 8 MiB in 60. A 404 is `not_published`, a 429
 * `rate_limited` with its `Retry-After` seconds, any other status and a failed or late request
 * `registry_unreachable`, and an answer too large or that does not read `bad_answer`. It sends no
 * credential and runs nothing it reads.
 */
export function createNpmRegistry(parts: {
  readonly download: HttpDownload;
  /** The registry's origin; npm's public one in production, a loopback stand-in in tests. */
  readonly base: string;
}): NpmRegistry {
  const { download } = parts;
  const origin = new URL(parts.base).origin;
  return {
    async version(name, version, signal) {
      const url = `${origin}/${pathName(name)}/${version}`;
      const read = await getBytes(download, { url, bound: documentBound }, signal);
      return read.ok ? versionOf(readJson(read.value)) : read;
    },
    async tarball(at, signal) {
      const url = URL.parse(at.tarball);
      return url?.origin === origin
        ? getBytes(download, { url: url.href, bound: tarballBound }, signal)
        : failed({ reason: "bad_answer" });
    },
    async attestations(name, version, signal) {
      const url = `${origin}/-/npm/v1/attestations/${pathName(name)}@${version}`;
      const read = await getBytes(download, { url, bound: documentBound }, signal);
      if (!read.ok) {
        return read;
      }
      const parsed = attestationsSchema.safeParse(readJson(read.value));
      return parsed.success ? ok(parsed.data.attestations) : failed({ reason: "bad_answer" });
    },
  };
}
