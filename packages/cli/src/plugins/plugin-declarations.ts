import { createHash } from "node:crypto";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import type { PluginReview } from "@binference/protocol";

/** What a community plugin declares, each list sorted: what its permission review shows. */
export type Declarations = Pick<PluginReview, "kinds" | "hosts" | "tools" | "configKeys">;

const sorted = (names: readonly string[]): readonly string[] =>
  [...new Set(names)].toSorted((a, b) => (a < b ? -1 : Number(a > b)));

function configKeysOf(manifest: CommunityManifest): readonly string[] {
  const properties = manifest.config?.["properties"];
  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties)
    : [];
}

/** The declarations a manifest makes: its kinds, hosts, tools' names and config keys. */
export function declarationsOf(manifest: CommunityManifest): Declarations {
  return {
    kinds: sorted(manifest.kinds),
    hosts: sorted(manifest.hosts),
    tools: sorted(manifest.tools.map(({ name }) => name)),
    configKeys: sorted(configKeysOf(manifest)),
  };
}

/**
 * The digest the owner accepts in the permission review (decision 0348): the SHA-256, in hex, of
 * the JSON `{"configKeys":[…],"hosts":[…],"kinds":[…],"tools":[…]}`, each list sorted.
 */
export function digestOf(declarations: Declarations): string {
  const { configKeys, hosts, kinds, tools } = declarations;
  const text = JSON.stringify({ configKeys, hosts, kinds, tools });
  return createHash("sha256").update(text).digest("hex");
}

/**
 * What the owner consents to in the permission review, its `digest` (decision 0348): the SHA-256,
 * in hex, of the JSON `{"declarations":…,"files":…,"integrity":…,"package":…,"version":…}`, the
 * declarations' digest, the files' pin, the tarball's npm integrity and the package by name and
 * version. An acceptance from one review installs nothing else.
 */
export function consentDigest(consented: {
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly files: string;
  readonly declarations: Declarations;
}): string {
  const { packageName, version, integrity, files } = consented;
  const declarations = digestOf(consented.declarations);
  const text = JSON.stringify({ declarations, files, integrity, package: packageName, version });
  return createHash("sha256").update(text).digest("hex");
}

const newIn = (old: readonly string[], now: readonly string[]): readonly string[] =>
  now.filter((name) => !old.includes(name));

/**
 * What `next` declares that `accepted` does not, or `undefined` when it declares nothing more:
 * an update inside its old acceptance (a widening adds a kind, a host, a tool or a config key).
 */
export function addedTo(accepted: Declarations, next: Declarations): Declarations | undefined {
  const added = {
    kinds: newIn(accepted.kinds, next.kinds),
    hosts: newIn(accepted.hosts, next.hosts),
    tools: newIn(accepted.tools, next.tools),
    configKeys: newIn(accepted.configKeys, next.configKeys),
  };
  const count = Object.values(added).reduce((total, names) => total + names.length, 0);
  return count === 0 ? undefined : added;
}
