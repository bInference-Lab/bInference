import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { describe, expect, it } from "vitest";
import { decideInstall, type InstallAnswers } from "./decide-install.js";
import type { FetchedPlugin } from "./fetch-plugin.js";
import { consentDigest, declarationsOf, digestOf } from "./plugin-declarations.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";

const tool = (name: string) => ({
  name,
  description: `The ${name} tool.`,
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object" },
});

const manifest: CommunityManifest = {
  api: 1,
  id: "fear-index",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [tool("index")],
};

const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const plugin = "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b";

const github = "https://token.actions.githubusercontent.com";
const repository = "github.com/example/fear-index";

function fetchedOf(
  change: {
    readonly manifest?: CommunityManifest;
    readonly hash?: string;
    readonly verified?: boolean;
    readonly publisher?: string;
    readonly issuer?: string;
    readonly account?: string;
  } = {},
): FetchedPlugin {
  const provenance =
    change.verified === false
      ? { provenance: "none" as const }
      : {
          provenance: "verified" as const,
          publisher: change.publisher ?? repository,
          issuer: change.issuer ?? github,
        };
  return {
    pkg: {
      files: [],
      manifest: change.manifest ?? manifest,
      filesHash: change.hash ?? "a".repeat(64),
    },
    provenance,
    registryPublisher: change.account ?? "fake-publisher",
  };
}

function answersOf(version: string, more: Partial<InstallAnswers> = {}): InstallAnswers {
  return {
    source: `npm:fear-index@${version}`,
    from: { name: "fear-index", version, integrity },
    ...more,
  };
}

const digest = digestOf(declarationsOf(manifest));

// The digest the owner accepts for a version: its package, version, integrity, files and
// declarations.
const consentOf = (version: string, files = "a".repeat(64), declared = manifest) =>
  consentDigest({
    packageName: "fear-index",
    version,
    integrity,
    files,
    declarations: declarationsOf(declared),
  });

function installed(change: Partial<LockedPlugin> = {}): PluginLock {
  const entry: LockedPlugin = {
    plugin,
    id: "fear-index",
    packageName: "fear-index",
    version: "1.0.0",
    source: "npm:fear-index@1.0.0",
    integrity,
    hash: "b".repeat(64),
    manifest,
    accepted: digest,
    provenance: "verified",
    publisher: repository,
    issuer: github,
    enabled: true,
    installedAt: 1,
    ...change,
  };
  return { plugins: [entry] };
}

const empty: PluginLock = { plugins: [] };
const decide = (lock: PluginLock, fetched: FetchedPlugin, answers: InstallAnswers) =>
  decideInstall(lock, fetched, { answers, newPlugin: () => plugin, now: 5 });

// The digest of the review a decision answers; a decision that answers none fails the test.
function digestOfReview(decision: ReturnType<typeof decide>): string {
  if (decision.kind !== "review") {
    throw new Error(`Expected a review, got ${decision.kind}.`);
  }
  return decision.review.digest;
}

describe("deciding a plugin install", () => {
  it("answers a new plugin's review, its publisher the repository its provenance names", () => {
    expect(decide(empty, fetchedOf(), answersOf("1.0.0"))).toStrictEqual({
      kind: "review",
      review: {
        plugin: "fear-index",
        version: "1.0.0",
        source: "npm:fear-index@1.0.0",
        hash: "a".repeat(64),
        publisher: "github.com/example/fear-index",
        provenance: "verified",
        kinds: ["data"],
        hosts: ["api.example.com"],
        tools: ["index"],
        configKeys: [],
        digest: consentOf("1.0.0"),
      },
    });
  });

  it("installs a new plugin once the owner accepted its digest, on", () => {
    const answers = answersOf("1.0.0", { accepted: consentOf("1.0.0") });

    expect(decide(empty, fetchedOf(), answers)).toMatchObject({
      kind: "install",
      entry: {
        plugin,
        id: "fear-index",
        accepted: digest,
        enabled: true,
        integrity,
        installedAt: 5,
      },
    });
  });

  it("asks again for a digest that is not the review's", () => {
    const answers = answersOf("1.0.0", { accepted: "c".repeat(64) });

    expect(decide(empty, fetchedOf(), answers)).toMatchObject({ kind: "review" });
  });

  it("binds an acceptance to the package, version and files it reviewed", () => {
    const accepted = { accepted: consentOf("1.0.0") };

    expect(
      decide(empty, fetchedOf({ hash: "c".repeat(64) }), answersOf("1.0.0", accepted)),
    ).toMatchObject({
      kind: "review",
    });
    expect(decide(empty, fetchedOf(), answersOf("1.0.1", accepted))).toMatchObject({
      kind: "review",
    });
  });

  it("refuses a new plugin once 64 are installed", () => {
    const [entry] = installed().plugins;
    const full = {
      plugins: Array.from(
        { length: 64 },
        (_, n) => ({ ...entry, id: `p${String(n)}`, packageName: `p${String(n)}` }) as LockedPlugin,
      ),
    };

    expect(decide(full, fetchedOf(), answersOf("1.0.0"))).toStrictEqual({
      kind: "refused",
      code: "plugin.too_many",
    });
  });

  it("installs a plugin without provenance only once the owner also typed its id", () => {
    const none = fetchedOf({ verified: false });
    const accepted = { accepted: consentOf("1.0.0") };

    expect(decide(empty, none, answersOf("1.0.0", accepted))).toMatchObject({
      kind: "review",
      review: { provenance: "none", publisher: "fake-publisher" },
    });
    expect(
      decide(empty, none, answersOf("1.0.0", { ...accepted, typedName: "fear-idx" })),
    ).toMatchObject({
      kind: "review",
    });
    expect(
      decide(empty, none, answersOf("1.0.0", { ...accepted, typedName: "fear-index" })),
    ).toMatchObject({
      kind: "install",
      entry: { provenance: "none" },
    });
  });

  it("installs an update that declares nothing more on the old acceptance", () => {
    const narrower = { ...manifest, hosts: [] };

    expect(
      decide(installed(), fetchedOf({ manifest: narrower }), answersOf("1.1.0")),
    ).toMatchObject({
      kind: "install",
      entry: { plugin, version: "1.1.0", accepted: digestOf(declarationsOf(narrower)) },
    });
  });

  it("holds an update that widens for its own review, naming what it adds", () => {
    const wider = {
      ...manifest,
      hosts: ["api.example.com", "x.example.net"],
      tools: [tool("index"), tool("whales")],
    };
    const decided = decide(
      installed(),
      fetchedOf({ manifest: wider }),
      answersOf("1.1.0", { accepted: consentOf("1.0.0") }),
    );

    expect(decided).toMatchObject({
      kind: "review",
      review: {
        widens: {
          from: "1.0.0",
          added: { kinds: [], hosts: ["x.example.net"], tools: ["whales"], configKeys: [] },
        },
      },
    });
  });

  it("holds an update that loses its provenance for a review that says so", () => {
    const decided = decide(installed(), fetchedOf({ verified: false }), answersOf("1.1.0"));

    expect(decided).toMatchObject({
      kind: "review",
      review: {
        widens: {
          from: "1.0.0",
          lostProvenance: true,
          publisher: { from: repository, to: "fake-publisher" },
        },
      },
    });
  });

  it("holds an update with the same names from another repository until the owner accepts it", () => {
    const moved = fetchedOf({ publisher: "github.com/mallory/fear-index" });
    const held = decide(installed(), moved, answersOf("1.3.0"));
    const accepted = decide(
      installed(),
      moved,
      answersOf("1.3.0", { accepted: digestOfReview(held) }),
    );

    expect(held).toMatchObject({
      kind: "review",
      review: {
        publisher: "github.com/mallory/fear-index",
        widens: {
          from: "1.0.0",
          added: { kinds: [], hosts: [], tools: [], configKeys: [] },
          publisher: { from: repository, to: "github.com/mallory/fear-index" },
        },
      },
    });
    expect(accepted).toMatchObject({
      kind: "install",
      entry: { publisher: "github.com/mallory/fear-index", version: "1.3.0" },
    });
  });

  it("holds an update signed through another issuer, or published by another npm account", () => {
    const gitlab = fetchedOf({ issuer: "https://gitlab.com" });
    const unproven = installed({
      provenance: "none",
      publisher: "fake-publisher",
    });
    const unprovenNoIssuer = {
      plugins: unproven.plugins.map(({ issuer: _gone, ...entry }) => entry),
    };
    const answers = answersOf("1.1.0", { typedName: "fear-index" });

    expect(decide(installed(), gitlab, answersOf("1.1.0"))).toMatchObject({
      kind: "review",
      review: { widens: { publisher: { from: repository, to: repository } } },
    });
    expect(
      decide(unprovenNoIssuer, fetchedOf({ verified: false, account: "other" }), answers),
    ).toMatchObject({
      kind: "review",
      review: { widens: { publisher: { from: "fake-publisher", to: "other" } } },
    });
  });

  it("holds an older version for a review that says it is older", () => {
    const decided = decide(installed({ version: "1.2.0" }), fetchedOf(), answersOf("1.1.0"));

    expect(decided).toMatchObject({
      kind: "review",
      review: { widens: { from: "1.2.0", older: true } },
    });
  });

  it("keeps a plugin the owner turned off off across an update", () => {
    const lock = installed({ enabled: false, disabledReason: "owner" });

    expect(decide(lock, fetchedOf(), answersOf("1.1.0"))).toMatchObject({
      kind: "install",
      entry: { enabled: false, disabledReason: "owner" },
    });
  });

  it("changes nothing for the same version and files", () => {
    const lock = installed({ version: "1.0.0", hash: "a".repeat(64) });

    expect(decide(lock, fetchedOf(), answersOf("1.0.0"))).toMatchObject({ kind: "unchanged" });
  });

  it("refuses an id another package installed, and a tool name another plugin holds", () => {
    const other = installed({ packageName: "fear-index-fork" });
    // `fear` with a tool `index__index` and `fear--index` with `index` both reach the agent as
    // `fear__index__index`.
    const clash = installed({
      id: "fear",
      manifest: { ...manifest, id: "fear", tools: [tool("index__index")] },
    });
    const twin = { ...manifest, id: "fear--index" };
    const long = { ...manifest, tools: [tool(`t${"x".repeat(60)}`)] };

    expect(decide(other, fetchedOf(), answersOf("1.0.0"))).toStrictEqual({
      kind: "refused",
      code: "plugin.id_taken",
    });
    expect(decide(clash, fetchedOf({ manifest: twin }), answersOf("1.0.0"))).toStrictEqual({
      kind: "refused",
      code: "plugin.invalid",
    });
    expect(decide(empty, fetchedOf({ manifest: long }), answersOf("1.0.0"))).toStrictEqual({
      kind: "refused",
      code: "plugin.invalid",
    });
  });
});
