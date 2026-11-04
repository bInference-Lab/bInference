# 0348. A community plugin installs from npm by its integrity and provenance, pinned by its files

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

[Decision 0300](0300-each-community-plugin-runs-in-a-process-of-its-own-that-speaks-only-to-the-plugin-host.md)
says `plugin/add` pins a plugin's files by hash in the plugin lock, shows the permission review,
checks npm provenance or else asks the owner to type the plugin's name, re-asks when an update
declares more, and refuses symlinks.
[Decision 0343](0343-the-plugin-host-runs-each-community-plugin-as-a-sealed-program-and-probes-every-gap-first.md)
leaves to the install the walk for links before each start and the refusal of the id
`sandbox-probe`. [Spec 1, section 7.8](../specs/protocol.md#section-7-8) gives the review's
shape. None of them says where a package comes from, how it is checked, what the pin covers, or
how the digest the owner accepts is made.

npm's registry serves one version's document at `GET /{package}/{version}`, whose `dist` names the
tarball, its SHA-512 integrity and, for a package built with provenance, an attestations URL. npm's
own fetcher reads the attestations from `/-/npm/v1/attestations/<name>@<version>` on the registry
it uses, checks that the statement's subject is the package URL and the tarball's SHA-512, and
verifies the Sigstore bundle with the `sigstore` package. That package finds its trust root through
Sigstore's TUF repository, which it fetches on first use and whenever its metadata expires, with
its own HTTP client. A package's own scripts run only when an npm client installs it.

## Decision

- **The source** is `npm:<name>@<version>`, an exact version, from `https://registry.npmjs.org`.
  No npm client runs and no script of the package runs: binference reads the registry itself.
- **The version's document**, `GET /<name>/<version>` with the scope's slash as `%2f`, has 30
  seconds and at most 1 MiB. Its `name` and `version` must be the ones asked for, `dist.integrity`
  one `sha512-` value and `dist.tarball` an `https` URL on the registry's own host. A 404 is
  `not_published`; a 429 is `rate_limited`, with the `Retry-After` seconds when given; any other
  status, a timeout or an answer that does not read is `registry_unreachable` or `bad_answer`.
  Each ends the job `plugin.fetch_failed` with the reason in `details.reason`, retryable but for
  `not_published`.
- **Every request** of an install, the version's document, the tarball and the attestations, goes
  through the engine's outbound `Http` port, so the owner's proxy and its no-proxy list apply
  ([decision 0347](0347-every-outbound-request-goes-through-the-owner-s-proxy-and-none-goes-around-it.md));
  the CLI puts the config's route in force before it reads the integrity itself.
- **The tarball** has 60 seconds and at most 8 MiB, and its SHA-512 must be `dist.integrity`, else
  `plugin.hash_mismatch`.
- **Provenance.** When `dist.attestations.provenance.predicateType` is
  `https://slsa.dev/provenance/v1`, the install reads `/-/npm/v1/attestations/<name>@<version>`
  from the registry's host, never the URL the document gives, at most 1 MiB. The attestation of
  that type must carry a DSSE envelope of `application/vnd.in-toto+json` whose statement
  (`https://in-toto.io/Statement/v1`) has one subject: `pkg:npm/<name>@<version>`, with `@` of a
  scope as `%40`, and the tarball's SHA-512 in hex. Sigstore's own verifier, `@sigstore/verify`,
  then checks the bundle against Sigstore's public trust root as `@sigstore/tuf` 5.0.0 shipped it,
  which binference keeps beside the verifier, with the verifier's own thresholds: one transparency
  log entry and one certificate transparency entry. Nothing leaves the machine for it. The
  signing certificate's OIDC issuer must be GitHub Actions
  (`https://token.actions.githubusercontent.com`) or GitLab (`https://gitlab.com`), the CI
  services npm's provenance documentation lists, and the certificate must hold the Source
  Repository URI extension. Any failure is `plugin.provenance_failed`, and so are attestations the
  document names and the registry does not hold: a broken attestation never reads as none. A
  version with no provenance attestation is `none`.
- **The publisher** the review shows, and where each field comes from: with provenance, the
  source repository from the certificate's Source Repository URI extension (Fulcio OID
  1.3.6.1.4.1.57264.1.12), without `https://`, such as `github.com/owner/repo`; the issuer from its
  OIDC issuer extension; and the build workflow from its subject alternative name, without
  `https://` and its ref, shown on a line of its own only when it lives in another repository, as
  a reusable workflow of another project does. Without provenance, the npm account the registry
  names as publisher (`_npmUser.name`). A name over 200 characters is not shown cut: provenance
  naming one is refused. Every name is escaped as a token name is.
- **Unpacking** happens in memory: only plain files under `package/`. A link, a device, an
  absolute path, a part with a character outside `A-Z a-z 0-9 . _ @ + -` or ending in `.`, a
  Windows device name (`con`, `nul`, `com1` and the like), a path over 200 characters or 16 parts,
  a file that is also another file's folder, a path twice when case is ignored, more than 1,000
  files or more than 16 MiB is `plugin.invalid`. The tar reader takes what npm's would: a header
  that is neither POSIX nor GNU ustar, a checksum that fails, a pax `size` or `linkpath`, an empty
  name or any byte but zero after the end refuses the archive, so no reader sees other files.
- **The manifest** is the `binference` field of `package/package.json`, read by the community
  manifest schema; the file's `name` and `version` must be the ones asked for and its entry must
  be one of the files. It declares at most what a review shows whole, `communityPluginLimits` of
  the protocol: 16 hosts of up to 100 characters, 32 tools, and 64 config keys of up to 64
  characters. The id `sandbox-probe` is `plugin.invalid`; an id another npm package installed
  holds is `plugin.id_taken`; a new plugin past 64 installed is `plugin.too_many`. Each tool reaches the agent as `<id>__<tool>`, the id's
  hyphens as underscores; a name past 64 characters, or one another installed plugin's tool holds,
  is `plugin.invalid`.
- **The pin** is the SHA-256 of the files: of one line per file in the order of its path, the path,
  a NUL, the hex SHA-256 of its bytes and a line feed. The review shows it as `hash`, 64 hex digits.
- **The declarations' digest** is the SHA-256, in hex, of the JSON
  `{"configKeys":[…],"hosts":[…],"kinds":[…],"tools":[…]}`, each list sorted: the config schema's
  top-level keys, the hosts, the kinds and the tools' names. The lock keeps it as `accepted`.
- **The digest** the owner accepts, the review's `digest`, is the SHA-256, in hex, of the JSON
  `{"declarations":…,"files":…,"integrity":…,"package":…,"version":…}`: the declarations' digest,
  the pin, the npm integrity, and the package by name and version. An acceptance from one review
  installs nothing else.
- **The review** shows every entry of every list, one line each, never cut; only the terminal's
  `binference plugin add` shows it, and any other surface gets `plugin.review_needed`, whose words
  send the owner there.
- **`plugin/add`** takes `{ source, hash, accepted?, typedName? }`, `hash` the version's npm
  integrity, as `skill/add` takes it; a registry that answers another is `plugin.hash_mismatch`.
  The CLI reads the integrity from the registry when the owner gives none. For a plugin not
  installed, a call without `accepted` ends `plugin.review_needed` with the review as JSON text in
  `details.review`, since an error's details hold plain values. A call with
  `accepted` equal to the review's digest installs it; without provenance `typedName` must also
  equal the plugin's id, else the review is needed again. For an installed plugin, another
  version of the same npm package is an update: one that is newer by SemVer, declares nothing
  more, keeps its provenance and comes from the same publisher and issuer installs at once. Any
  other ends `plugin.review_needed` with `widens: { from, added, publisher?, lostProvenance?,
older? }`: `added` holds the new kinds, hosts, tools and config keys, `publisher` the old and new
  publisher side by side when the source repository, the issuer or, without provenance, the npm
  account changed, `lostProvenance` a verified version followed by one without, and `older` a
  version that SemVer puts before the installed one. It needs its own `accepted`; one without
  provenance needs `typedName` again. Until then the old version runs. The same version again
  changes nothing. While an install runs, the same call gets its job, and any other `plugin/add`
  `protocol.busy` with the running job's id in `details.job`.
- **The install** writes the files in a work folder beside `plugins/`, then moves them to
  `plugins/packages/<id>/`, with an empty `plugins/data/<id>/`, all owner-only. The plugin lock
  `plugins/lock.json` is the one record of installed plugins: for each id its `plg_` id, package
  name, version, source, integrity, pin, manifest, accepted digest, provenance, publisher, whether
  it is on and why not, and when it was installed; each `id` holds to the manifest's id pattern
  and equals its manifest's. The lock is written whole, beside it then moved in place, after the
  files are in place. A lock that does not read is never written over: every plugin operation
  answers `plugin.lock_unreadable`, no plugin runs, and the start logs it. A running plugin of that
  id stops before the move and the new version starts after it. Files that cannot be written, or
  a move that fails, leave the installed package in place, its version runs again, and the job
  ends `plugin.install_failed`.
- **Before each start** the host runs a plugin only when the declarations of its lock entry hash
  to the accepted digest, its folder holds no link, no second hard link and nothing but folders
  and plain files, and its files hash to the pin. Any other answer turns it off at once
  (`disabledReason: changed`) and tells the owner `notice.pluginChanged`; a restart never mends
  it, so it is not counted as a crash.
- **`binference check`**: `plugins.sandbox` fails while the sandbox does not hold once a plugin
  is installed, since that plugin cannot run, and warns while none is. While the sandbox holds with
  plugins under the owner's own OS user, it warns once a plugin is installed that a plugin could
  signal every process of that user, the engine among them.
- **`plugin/enable`, `plugin/disable` and `plugin/remove`**: a disable stops the plugin at once
  (`disabledReason: owner`); an enable runs it again once the sandbox check passed, both written
  from the lock as the change reads it, and each answers the plugin as the lock holds it once its
  start settled, so an enable the host refused answers off; a remove stops it, removes its data
  folder, then its lock entry and its package. A data folder that stays keeps the plugin installed
  and running, and the call ends `plugin.data_not_removed`, so the owner asks again.

## Consequences

- No byte of a plugin runs before the owner accepted its review, and a file changed on disk after
  that stops it before its next start.
- A package without provenance can still be installed, but only after the owner types its id;
  one whose attestation fails cannot be installed at all.
- The trust root is the one `@sigstore/tuf` 5.0.0 shipped, in
  `packages/cli/src/plugins/sigstore-trusted-root.json`. The cost of keeping it offline: when
  Sigstore rotates a key or opens a new transparency log shard, every version signed under the new
  key is refused as `plugin.provenance_failed`, on every install, until the owner runs a release
  of binference that knows it; versions signed under the keys it holds keep passing. A newer root
  ships as an ordinary release: the `@sigstore/tuf` update copies its seed's trusted root into
  that file, and the recorded attestation test runs against it, in one commit.
- A registry mirror needs a config key and its migration; v1 reads npm's public registry only.
- The `plugins` table of `engine.sqlite` stays empty: one record, the lock, decides what is
  installed, so two copies never disagree. Spec 3 says so. Engine migration 0060, kept for this
  work, is unused, and the next engine migration may take it.
- `pnpm test` runs the install against a fake registry on loopback, and the provenance check
  against a recorded real attestation; no test installs a real package.

## Alternatives

- **Run `npm pack` or `npm install`.** Either runs npm's client and its config, and `install` runs
  the package's scripts; reading the registry directly leaves nothing of the package to run.
- **Pin the tarball's integrity alone.** The engine cannot hash a tarball it no longer has before
  each start; the files' own hash checks what the plugin process reads.
- **Treat a failing attestation as no provenance.** A tampered package would then install after a
  typed name; a failure is a refusal.
- **`sigstore`'s `verify` with its TUF client.** It keeps the trust root fresh, but reaches
  Sigstore's TUF repository through an HTTP client of its own, outside the engine's outbound
  requests and proxy, and the first install on a machine depends on that host.
- **Verify the registry's ECDSA signatures too.** They bind name, version and integrity to the
  registry's key, which the TLS connection to the registry already does for this one registry.
- **The `plugins` table as a second record.** The spec had it mirror the lock; two copies
  written one after the other can disagree after a crash, and nothing reads the table.
- **Hash every declaration, schemas and descriptions included, into the digest.** Then a fixed
  typo in a description would ask the owner again; the digest covers what the plugin may reach.
