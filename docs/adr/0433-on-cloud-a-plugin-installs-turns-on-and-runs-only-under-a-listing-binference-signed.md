# 0433. On Cloud a plugin installs, turns on and runs only under a listing bInference signed

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

The owner decided on 2026-11-05 that bInference Cloud offers plugins only from a store bInference
reviews: each plugin runs in a sandboxed process of its own on the shared workers, and no other
community plugin installs there. On self-hosted,
[decision 0348](0348-a-community-plugin-installs-from-npm-by-its-integrity-and-provenance-pinned-by-its-files.md)
lets the owner install any npm package by its integrity, checks its npm provenance offline, shows
the permission review and asks again when an update widens; decisions 0349 to 0351 run, mark and
remove it. Self-hosted keeps all of it.

The listing catalog on binference.io reviews one version of a package, signs a listing of it with a
key in KMS, and serves the signed listings and a revocation list to the workers
([decision 0434](0434-a-plugin-listing-is-signed-with-ed25519-over-a-statement-of-its-kind-key-and-digest.md)
gives the listing and its signature,
[decision 0435](0435-a-signed-revocation-list-stops-a-revoked-plugin-and-a-stale-one-holds-every-listed-plugin.md)
the revocation list). The catalog, its key and its transport live outside this repository; what a
worker's install path does with their answers lives here, in `cli`, the one package that installs
plugins.

[Rule 19](../ARCHITECTURE.md#rule-19) makes a profile difference wiring, never a branch.
`ProfileParts` names the parts each composition root fills, as `quotas` for
[decision 0431](0431-quotas-come-from-one-port-and-are-counted-from-the-install-s-stores.md). A
rule a config key could turn off would be one config change away from open installs on Cloud.

## Decision

- **The rule is a profile part.** `ProfileParts` gains `pluginListing: PluginListingRule`. The
  field is required, so a composition root that leaves it out does not compile.
  - `{ kind: "notRequired" }`: installs as decisions 0348 to 0351 have them. The self-hosted root
    sets it.
  - `{ kind: "required", keys, catalog }`: every install, enable, update and start needs a plugin
    listing that verifies with one of `keys` and that the newest revocation list does not name.
    `keys` are the public halves of the listing keys, constants of the Cloud worker's deploy.
    `catalog` is the port `PluginListingCatalog`, with three reads: `find(name, version)`, the
    listings of one package version; `get(listing)`, one listing by its id; and `revocations()`,
    the newest revocation list. Each takes an `AbortSignal` and answers the catalog's signed text
    as it came, or `unreachable` or `bad_answer`. Each read has 15 seconds on the engine's clock,
    raced against the read whatever the adapter does with its signal, and `find` answers at most 8
    envelopes, more being `bad_answer` before any is verified. The Cloud test root sets it, with a
    fake catalog that signs with a key the test makes.

  No config key, flag, environment variable or protocol operation reads or changes the rule. The
  plugin composer takes it from the root's profile parts and names none itself; one function joins
  the listing gate, the listed runner and the revocation list's watch, so no root wires them in
  another order.

- **Self-hosted stays as it is.** Under `notRequired` no install path reads a catalog, the plugin
  lock is written byte for byte as today, the review and `plugin/list` carry no field this
  decision adds, and no notice it adds is sent. The self-hosted install tests pass unchanged. A
  self-hosted engine reads the lock in its own form, so a lock that holds a listing or a
  revocation floor does not read there, as before.
- **The install path checks, never the catalog.** It verifies each listing and revocation list
  itself, with the `keys` the root hands it and `node:crypto` (decision 0434), and compares the
  listing with what it fetched. An answer of the catalog that does not verify is refused, so a
  catalog or a transport that lies cannot install a plugin, turn one on or keep one running.
- **`plugin/add` of a new plugin**, under `required`, runs in its job in this order:
  1. It reads the catalog's listings of the package at that exact version, and takes the newest
     revocation list the engine holds (decision 0435). No listing is `plugin.not_listed`; one that
     does not verify under a key in force, or is not in its canonical form, is
     `plugin.listing_unverified`; one the list names is `plugin.listing_revoked`; a catalog that
     cannot be read, an answer that does not read as signed listings, or no fresh list is
     `plugin.listings_unreachable`, retryable, with `details.reason` (`unreachable`, `bad_answer`
     or `stale`). The listing's highest `version` counts. A listing the lock marks revoked on an
     entry is `plugin.listing_revoked` whatever the list says now (decision 0435), and so is one a
     list taken while the read waited names.
  2. `hash` must be the listing's `integrity`, else `plugin.listing_mismatch` with
     `details.field: "integrity"`. Nothing has been fetched yet: no byte bInference did not review
     reaches the worker.
  3. The fetch and its checks run as decision 0348 has them.
  4. What was fetched must equal the listing, field by field, in this order: the package name, the
     package version, the integrity, the files' pin, the manifest's id, the provenance (`verified`
     or `none`), the publisher, the issuer and the workflow as the lock would store them, then the
     kinds, hosts, tools and config keys as the review shows them. The first field that differs is
     `plugin.listing_mismatch`, named in `details.field`.
  5. The review, the typed name, the consent digest and the quota of plugins on run as decisions
     0348 and 0431 have them. The review JSON gains `listing: { listing, version }`, which the
     consent digest does not hash, and the review shows a line that bInference reviewed and listed
     the plugin.
  6. The lock's change that writes the entry reads the newest revocation list the engine took,
     with no new read, and writes the entry off as revoked when that list names the listing now,
     as an enable that took the last room writes one off (decision 0431). The job then answers
     the plugin off and revoked, and the owner gets `notice.pluginRevoked`.

  The lock entry gains `listing: { listing, version }`.

- **An update** is a `plugin/add` of another version of the package. That version needs a listing
  of its own, checked as above; widening and consent stay as decision 0348 has them. An update of a
  plugin turned off as revoked to a version that is listed starts on, as any update of a plugin the
  owner did not turn off.
- **`plugin/enable`**, under `required`, reads the plugin's listing by its id and the newest
  revocation list, before the quota. The listing must verify, its `version` must be at least the
  one the lock holds (an older one is `plugin.listings_unreachable` with `bad_answer`), it must
  equal the lock entry field by field as in step 4, and the list must not name it; else the same
  codes answer and nothing changes. A lock entry the lock marks revoked is `plugin.listing_revoked`
  before the catalog is read. The lock's change that turns the plugin on refuses it again, writing
  nothing, when the lock marks it revoked or the newest list the engine took names it, so a list
  taken while the enable checked cannot be missed. A newer `version` that passes is written into
  the lock entry with that change. A lock entry with no listing is `plugin.not_listed`.
- **A start** (the plugin runner's first `begin`), under `required`, first reads the revocation
  list, turning off each plugin it revokes (decision 0435), then checks each enabled plugin's
  listing as an enable does before the host starts any. One that fails for any other reason, and
  every one while no revocation list is fresh, is held: not started, its tools not offered to the
  agent, its lock entry unchanged. Only a passed check ends a hold, and the runner starts a listed
  plugin only after its own check passes against a fresh list, so a failed removal or a failed
  install write never starts a held plugin.
- **Braking never waits on the catalog.** `plugin/disable`, `plugin/remove` and `plugin/call` read
  no catalog, so a catalog that cannot be read never keeps a plugin on or installed.
- **A listed plugin stays a community plugin.** Its tier stays `community`: the same sandbox, the
  same read-only tools and the same marks as decisions 0349 and 0350 give it. A listing adds
  bInference's review before the owner's; it loosens nothing.
- **What surfaces see.** `plugin/list` gains an optional
  `listing: { listing, version, state }`, `state` being `listed`, `revoked`, `held` or `unlisted`
  (an entry with no listing under `required`, which never runs). A revoked plugin is `disabled`
  with the reason it was off for before, if any, so a client that reads that field's three values
  keeps working.
- **The codes**, additions to the `plugin` area: `not_listed`, `listing_unverified`,
  `listing_mismatch`, `listing_revoked` and `listings_unreachable`, with words and a next step in
  English and Chinese ([spec 4, section 6](../specs/cards-and-messages.md#section-6)). The id
  prefix `pls_` names a plugin listing.

## Consequences

- On Cloud, a package version bInference did not review is never fetched, and one whose bytes or
  declarations differ from its review never runs.
- The owner's permission review stays: a listing is a gate, and never consents for the owner.
- Each add, enable and start on Cloud reads the catalog once for each plugin it checks; the Cloud
  adapter may serve every install of a worker from one read.
- `PluginListingCatalog` gets a contract suite that the fake and the Cloud adapter both pass.
- The lock's schema gains an optional `listing` on each entry and an optional top-level
  `revocations` floor (decision 0435). A self-hosted lock holds neither, so its bytes do not
  change. No config migration and no store migration.
- Three things come with the Cloud surfaces and workers, not here: where the Cloud keeps the
  plugin lock and the packages; how a Cloud owner reviews and adds a plugin from the console, since
  `plugin/add` is local and its review shows only in a terminal today; and Cloud words for the
  plugin notices that name `binference plugin` commands.
- Spec 1 (sections 1.1, 7.8 and 10), spec 3 (section 2.8), spec 4 (sections 3.10, 4 and 6),
  ARCHITECTURE.md (sections 14 and 30) and the glossary change with this decision.

## Alternatives

- **A config key such as `plugins.source: "listed"`.** A user who reaches a config change, or a
  bug in one, would open installs; a profile part cannot change once the root is built.
- **An optional part, absent meaning open.** A Cloud root that forgot it would install anything;
  a required field makes each root choose.
- **Trust what the catalog's transport answers.** A path that lies, or a catalog service broken
  into without the KMS key, would install anything; the install path's own check needs only the
  public keys.
- **The Verified tier for listed plugins.** The glossary's Verified tier is a publisher trusted
  with more than reads; a listing changes nothing of what a plugin may do.
- **Check the listing only after the fetch.** The worker would download and unpack bytes no one
  reviewed.
- **Let the listing replace the owner's review.** The owner still decides what reaches their
  agent; a listing says only that bInference reviewed it.
- **Turn a plugin off when its check cannot run.** An outage of the catalog would turn every
  plugin off for good, and each owner would turn each one on again; a hold ends by itself.
