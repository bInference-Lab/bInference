import { communityPluginLimits, type PluginReview } from "@binference/protocol";
import { pluginToolName } from "@binference/runtime";
import type { FetchedPlugin, PluginSource } from "./fetch-plugin.js";
import {
  addedTo,
  consentDigest,
  type Declarations,
  declarationsOf,
  digestOf,
} from "./plugin-declarations.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import { isOlderVersion } from "./version-order.js";

/** What `plugin/add` asks for besides its source: the review it accepts and the typed name. */
export interface InstallAnswers {
  readonly source: string;
  readonly from: PluginSource;
  readonly accepted?: string;
  readonly typedName?: string;
}

/** What an install does with a fetched plugin. */
export type InstallDecision =
  | { readonly kind: "review"; readonly review: PluginReview }
  | { readonly kind: "install"; readonly entry: LockedPlugin }
  | { readonly kind: "unchanged"; readonly entry: LockedPlugin }
  | {
      readonly kind: "refused";
      readonly code: "plugin.id_taken" | "plugin.invalid" | "plugin.too_many";
    };

const maxToolName = 64;
const nothing: Declarations = { kinds: [], hosts: [], tools: [], configKeys: [] };

/** Who signed a version: the publisher the review shows, the issuer and the build workflow. */
export interface Publisher {
  readonly publisher?: string;
  readonly issuer?: string;
  readonly workflow?: string;
}

// Each tool's name as the agent calls it fits and is held by no other installed plugin.
function toolsFit(lock: PluginLock, fetched: FetchedPlugin): boolean {
  const { id, tools } = fetched.pkg.manifest;
  const names = tools.map(({ name }) => pluginToolName(id, name));
  const held = new Set(
    lock.plugins
      .filter((plugin) => plugin.id !== id)
      .flatMap((plugin) =>
        plugin.manifest.tools.map(({ name }) => pluginToolName(plugin.id, name)),
      ),
  );
  return names.every((name) => name.length <= maxToolName && !held.has(name));
}

/**
 * Who a fetched version says signed it, as the plugin lock stores it: with provenance, the source
 * repository, issuer and workflow its certificate names; without it, the npm account the registry
 * names.
 */
export function publisherOf(fetched: FetchedPlugin): Publisher {
  const { provenance, registryPublisher } = fetched;
  if (provenance.provenance === "verified") {
    const { publisher, issuer, workflow } = provenance;
    return { publisher, issuer, ...(workflow === undefined ? {} : { workflow }) };
  }
  return registryPublisher === undefined ? {} : { publisher: registryPublisher.slice(0, 200) };
}

// A publisher or issuer other than the installed one's: the publishers on both sides, either
// absent when npm names none.
function publisherChange(
  installed: LockedPlugin,
  fetched: FetchedPlugin,
): NonNullable<PluginReview["widens"]>["publisher"] {
  const { publisher, issuer } = publisherOf(fetched);
  if (installed.publisher === publisher && installed.issuer === issuer) {
    return undefined;
  }
  return {
    ...(installed.publisher === undefined ? {} : { from: installed.publisher }),
    ...(publisher === undefined ? {} : { to: publisher }),
  };
}

const flagsOf = (flags: { readonly lost: boolean; readonly older: boolean }) => ({
  ...(flags.lost ? { lostProvenance: true as const } : {}),
  ...(flags.older ? { older: true as const } : {}),
});

// The widening an update brings (decision 0348): what it declares beyond the accepted version, a
// publisher or issuer other than the installed one's, the provenance it lost, or an older
// version; none for a new plugin or an update inside its old acceptance.
function wideningOf(
  installed: LockedPlugin | undefined,
  fetched: FetchedPlugin,
  version: string,
): PluginReview["widens"] {
  if (installed === undefined) {
    return undefined;
  }
  const added = addedTo(declarationsOf(installed.manifest), declarationsOf(fetched.pkg.manifest));
  const publisher = publisherChange(installed, fetched);
  const lost = installed.provenance === "verified" && fetched.provenance.provenance === "none";
  const older = isOlderVersion(version, installed.version);
  if (added === undefined && publisher === undefined && !lost && !older) {
    return undefined;
  }
  return {
    from: installed.version,
    added: added ?? nothing,
    ...(publisher === undefined ? {} : { publisher }),
    ...flagsOf({ lost, older }),
  };
}

function reviewOf(
  fetched: FetchedPlugin,
  answers: InstallAnswers,
  widens: PluginReview["widens"],
): PluginReview {
  const { manifest, filesHash } = fetched.pkg;
  const declarations = declarationsOf(manifest);
  const { publisher, workflow } = publisherOf(fetched);
  const { name, version, integrity } = answers.from;
  return {
    plugin: manifest.id,
    version,
    source: answers.source,
    hash: filesHash,
    ...(publisher === undefined ? {} : { publisher }),
    ...(workflow === undefined ? {} : { workflow }),
    provenance: fetched.provenance.provenance,
    ...declarations,
    digest: consentDigest({
      packageName: name,
      version,
      integrity,
      files: filesHash,
      declarations,
    }),
    ...(widens === undefined ? {} : { widens }),
  };
}

function entryOf(
  review: PluginReview,
  fetched: FetchedPlugin,
  made: {
    readonly answers: InstallAnswers;
    readonly installed: LockedPlugin | undefined;
    readonly plugin: string;
    readonly now: number;
  },
): LockedPlugin {
  const { installed, answers } = made;
  const { publisher, issuer, workflow } = publisherOf(fetched);
  // An update keeps a plugin the owner turned off off; any other plugin starts on.
  const off = installed?.disabledReason === "owner";
  return {
    plugin: installed?.plugin ?? made.plugin,
    id: review.plugin,
    packageName: answers.from.name,
    version: review.version,
    source: review.source,
    integrity: answers.from.integrity,
    hash: review.hash,
    manifest: fetched.pkg.manifest,
    accepted: digestOf(declarationsOf(fetched.pkg.manifest)),
    provenance: review.provenance,
    ...(publisher === undefined ? {} : { publisher }),
    ...(issuer === undefined ? {} : { issuer }),
    ...(workflow === undefined ? {} : { workflow }),
    enabled: !off,
    ...(off ? { disabledReason: "owner" as const } : {}),
    installedAt: made.now,
  };
}

// What decides before any review: an id another package holds, a tool name that does not fit,
// one plugin past the most binference installs, or the same files again.
function beforeReview(
  lock: PluginLock,
  fetched: FetchedPlugin,
  answers: InstallAnswers,
): InstallDecision | undefined {
  const installed = lock.plugins.find((plugin) => plugin.id === fetched.pkg.manifest.id);
  if (installed !== undefined && installed.packageName !== answers.from.name) {
    return { kind: "refused", code: "plugin.id_taken" };
  }
  if (!toolsFit(lock, fetched)) {
    return { kind: "refused", code: "plugin.invalid" };
  }
  if (installed === undefined && lock.plugins.length >= communityPluginLimits.installed) {
    return { kind: "refused", code: "plugin.too_many" };
  }
  const same = installed?.hash === fetched.pkg.filesHash;
  return same && installed.version === answers.from.version
    ? { kind: "unchanged", entry: installed }
    : undefined;
}

/**
 * Decides what `plugin/add` does with a fetched plugin (decision 0348). An id another npm package
 * holds is `plugin.id_taken`; a tool whose name as the agent calls it is too long or held by
 * another plugin is `plugin.invalid`; a new plugin past the 64 installed is `plugin.too_many`. The
 * same files as installed change nothing. A new plugin installs once `accepted` is the review's
 * digest, which binds the package, version, integrity, files and declarations; an update installs
 * at once when it is newer, declares nothing more and keeps its provenance, publisher and issuer,
 * and else once `accepted` is the digest of a review that names what it widens. A plugin without
 * provenance also needs `typedName` to be its id, at each install and update. Anything else
 * answers the review.
 */
export function decideInstall(
  lock: PluginLock,
  fetched: FetchedPlugin,
  made: {
    readonly answers: InstallAnswers;
    readonly newPlugin: () => string;
    readonly now: number;
  },
): InstallDecision {
  const { answers } = made;
  const decided = beforeReview(lock, fetched, answers);
  if (decided !== undefined) {
    return decided;
  }
  const { id } = fetched.pkg.manifest;
  const installed = lock.plugins.find((plugin) => plugin.id === id);
  const widens = wideningOf(installed, fetched, answers.from.version);
  const review = reviewOf(fetched, answers, widens);
  const typed = fetched.provenance.provenance === "verified" || answers.typedName === id;
  const keepsAcceptance = installed !== undefined && widens === undefined;
  const consented = keepsAcceptance || answers.accepted === review.digest;
  if (!typed || !consented) {
    return { kind: "review", review };
  }
  const plugin = made.newPlugin();
  return {
    kind: "install",
    entry: entryOf(review, fetched, { answers, installed, plugin, now: made.now }),
  };
}
