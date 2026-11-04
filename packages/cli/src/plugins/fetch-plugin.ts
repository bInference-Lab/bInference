import { err, ok, type Result } from "@binference/core";
import { sha512Integrity } from "../skills/fetch-skill.js";
import { readSkillSource } from "../skills/skill-source.js";
import { type BundleVerifier, checkProvenance, type ProvenanceOutcome } from "./npm-provenance.js";
import type { NpmRegistry, NpmVersion, RegistryFailure } from "./npm-registry.js";
import { failed, type Outcome } from "./outcome.js";
import { type PluginPackage, readPluginPackage } from "./plugin-package.js";

/** What `plugin/add` installs from: one npm package at an exact version, and its integrity. */
export interface PluginSource {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

/**
 * Reads `plugin/add`'s source and hash: `npm:<name>@<version>`, an exact version, with its npm
 * integrity, as `skill/add` reads an npm source; a folder inside the package, git, or anything
 * else is `bad_source`.
 */
export function readPluginSource(source: string, hash: string): Result<PluginSource, "bad_source"> {
  const read = readSkillSource(source, hash);
  if (!read.ok || read.value.kind !== "npm" || read.value.folder !== undefined) {
    return err("bad_source");
  }
  const { spec, integrity } = read.value;
  const at = spec.lastIndexOf("@");
  return ok({ name: spec.slice(0, at), version: spec.slice(at + 1), integrity });
}

/** A plugin fetched and checked, nothing of it written yet. */
export interface FetchedPlugin {
  readonly pkg: PluginPackage;
  readonly provenance: ProvenanceOutcome;
  /** The npm account the registry names as publisher, shown when no provenance names one. */
  readonly registryPublisher?: string;
}

/** Why a fetch gave no plugin, as the error code its job ends with. */
export type FetchFailure =
  | ({ readonly code: "plugin.fetch_failed" } & RegistryFailure)
  | { readonly code: "plugin.hash_mismatch" }
  | { readonly code: "plugin.provenance_failed" }
  | { readonly code: "plugin.invalid" };

function registryFailure(failure: RegistryFailure): FetchFailure {
  return { code: "plugin.fetch_failed", ...failure };
}

// The version's document and its tarball, each checked against what the source names.
async function fetchTarball(
  registry: NpmRegistry,
  source: PluginSource,
  signal: AbortSignal,
): Promise<Outcome<{ readonly version: NpmVersion; readonly bytes: Uint8Array }, FetchFailure>> {
  const version = await registry.version(source.name, source.version, signal);
  if (!version.ok) {
    return failed(registryFailure(version.failure));
  }
  const named = version.value.name === source.name && version.value.version === source.version;
  if (!named) {
    return failed(registryFailure({ reason: "bad_answer" }));
  }
  if (version.value.integrity !== source.integrity) {
    return failed({ code: "plugin.hash_mismatch" });
  }
  const tarball = await registry.tarball(version.value, signal);
  if (!tarball.ok) {
    return failed(registryFailure(tarball.failure));
  }
  return sha512Integrity(tarball.value) === source.integrity
    ? ok({ version: version.value, bytes: tarball.value })
    : failed({ code: "plugin.hash_mismatch" });
}

/**
 * Fetches a community plugin from npm and checks it before anything is written (decision 0348):
 * the version's document must name the package and version asked for and the integrity given,
 * else `plugin.hash_mismatch`; its tarball must hash to that integrity; its provenance, when its
 * document names one, must verify, else `plugin.provenance_failed`; and its package must read as
 * a community plugin, else `plugin.invalid`. A registry that cannot answer is
 * `plugin.fetch_failed` with its reason.
 */
export async function fetchPlugin(
  parts: { readonly registry: NpmRegistry; readonly verify: BundleVerifier },
  source: PluginSource,
  signal: AbortSignal,
): Promise<Outcome<FetchedPlugin, FetchFailure>> {
  const fetched = await fetchTarball(parts.registry, source, signal);
  if (!fetched.ok) {
    return fetched;
  }
  const { version, bytes } = fetched.value;
  const provenance = await checkProvenance(parts, version, signal);
  if (!provenance.ok) {
    const { failure } = provenance;
    return failed(
      failure.reason === "provenance_failed"
        ? { code: "plugin.provenance_failed" }
        : registryFailure(failure),
    );
  }
  const pkg = readPluginPackage(bytes, source);
  if (!pkg.ok) {
    return failed({ code: "plugin.invalid" });
  }
  const { publisher } = version;
  return ok({
    pkg: pkg.value,
    provenance: provenance.value,
    ...(publisher === undefined ? {} : { registryPublisher: publisher }),
  });
}
