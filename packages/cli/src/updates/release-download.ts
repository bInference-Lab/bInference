import { err, ok, type Result } from "@binference/core";
import {
  type BundleVerifier,
  checkProvenance,
  type SignerIdentity,
} from "../plugins/npm-provenance.js";
import type { NpmRegistry, NpmVersion, RegistryFailure } from "../plugins/npm-registry.js";
import { sha512Integrity } from "../skills/fetch-skill.js";
import { releasePackage } from "./release-feed.js";

/**
 * Why a release cannot be installed: npm does not hold the version, cannot be read, its tarball is
 * not the one its document names, or its provenance is not binference's own release build.
 */
export type DownloadFailure =
  | "not_published"
  | "registry_unreachable"
  | "hash_mismatch"
  | "provenance_failed";

/** The repository binference's releases are built from, as npm provenance names it. */
const releaseRepository = "github.com/bInference-Lab/bInference";

const githubActions = "https://token.actions.githubusercontent.com";
// The release workflow of that repository, run from the version's own tag (decision 0353), as the
// signing certificate names it.
function releaseWorkflowOf(version: string): string {
  return `https://${releaseRepository}/.github/workflows/release.yml@refs/tags/v${version}`;
}

function failureOf(failure: RegistryFailure): DownloadFailure {
  return failure.reason === "not_published" ? "not_published" : "registry_unreachable";
}

// The verifier, keeping what the certificate it verified names, so its workflow can be pinned.
function watching(verify: BundleVerifier): {
  readonly verify: BundleVerifier;
  readonly seen: SignerIdentity[];
} {
  const seen: SignerIdentity[] = [];
  return {
    seen,
    verify: async (bundle, signal) => {
      const verified = await verify(bundle, signal);
      if (verified.ok) {
        seen.push(verified.value);
      }
      return verified;
    },
  };
}

/**
 * Reads one release of binference from the registry and checks it (decision 0356): its document,
 * its tarball, which must hash to the document's integrity, and its npm provenance, which must be
 * verified, built by GitHub Actions from `github.com/bInference-Lab/bInference` with that
 * repository's `.github/workflows/release.yml` run from the tag `v<version>`. A version without
 * provenance, or with any other, is `provenance_failed`: nothing gets past it. Answers the
 * tarball's bytes.
 */
export async function downloadRelease(
  parts: { readonly registry: NpmRegistry; readonly verify: BundleVerifier },
  version: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, DownloadFailure>> {
  const document = await parts.registry.version(releasePackage, version, signal);
  if (!document.ok) {
    return err(failureOf(document.failure));
  }
  const tarball = await parts.registry.tarball(document.value, signal);
  if (!tarball.ok) {
    return err(failureOf(tarball.failure));
  }
  if (sha512Integrity(tarball.value) !== document.value.integrity) {
    return err("hash_mismatch");
  }
  const built = await releaseBuilt(parts, document.value, signal);
  return built.ok ? ok(tarball.value) : built;
}

// Whether the version's provenance is binference's own release build, and nothing else.
async function releaseBuilt(
  parts: { readonly registry: NpmRegistry; readonly verify: BundleVerifier },
  version: NpmVersion,
  signal: AbortSignal,
): Promise<Result<void, DownloadFailure>> {
  const watched = watching(parts.verify);
  const checked = { registry: parts.registry, verify: watched.verify };
  const provenance = await checkProvenance(checked, version, signal);
  if (!provenance.ok) {
    const { failure } = provenance;
    return err(failure.reason === "provenance_failed" ? failure.reason : failureOf(failure));
  }
  const outcome = provenance.value;
  const [signer] = watched.seen;
  const isRelease =
    outcome.provenance === "verified" &&
    outcome.publisher === releaseRepository &&
    outcome.issuer === githubActions &&
    signer !== undefined &&
    signer.signedBy === releaseWorkflowOf(version.version);
  return isRelease ? ok(undefined) : err("provenance_failed");
}
