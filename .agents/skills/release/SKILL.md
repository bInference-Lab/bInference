---
name: release
description: Cuts a binference release on the beta or stable channel, from the dry run through the signed tag to the publish run by hand. Use when asked to release, publish to npm or prepare a release tag.
---

# Cut a release

A release reaches owners who run it next to their money, and npm never lets a version go once it
is out. Decisions 0063, 0352, 0353 and 0451 set the rules; `release.yml` and `pnpm release:dry`
enforce them. Publishing needs the owner's word every time.

## 1. Pick the version

- Calver `YYYY.M.PATCH`, the year and month of the release, no leading zeros. The tag is the
  version with a `v`.
- Beta: `v2026.11.0-beta.1`, then `-beta.2`, publishing to npm's `beta` dist-tag. Stable:
  `v2026.11.0`, publishing to `latest`. Releases support macOS only and publish no image until
  Linux returns (decision 0449).
- The version must be newer than every release tag in the repository, as npm orders versions: a
  beta comes before the stable release it leads to. A mistake ships as the next patch, never as a
  second try at the same version.

## 2. Write the notes for owners

Every stable and beta release has notes for owners (decision 0355), which `binference` shows in
the update notice: `release/notes/<version>.en.json` and `release/notes/<version>.zh.json`, each a
JSON list of 1 to 5 lines of at most 200 characters, saying what changed for an owner in plain
words, never commit subjects. Commit them on `master` before the tag; the dry run refuses a
release without them, and packs them into the `binference` package as `binference.releaseNotes`.

```json
["Stop-loss orders fill within one block of their price."]
```

Write the release's entry in `CHANGELOG.md` and `CHANGELOG.zh.md` too, under a `## <version>`
heading, such as `## 2026.11.0-beta.1`: what it does for owners and its known limits. The dry run
refuses a stable or beta release whose version has no heading in both.

## 3. Dry-run it from master

On a clean checkout of the `master` commit you will tag:

```sh
pnpm release:dry v2026.11.0-beta.1
```

It refuses a tag outside calver, a tree with changes, a tag that names another commit, a release
without its notes for owners or its changelog heading, and a
version that is not newer. It reads each package on npm before it builds: it refuses a version npm
holds already (unless the tag names HEAD, as on a run that publishes again) or one not newer than
every version npm holds, prints each package's dist-tags, and names the packages whose first
publish needs `NPM_BOOTSTRAP_TOKEN`. When npm does not answer, it warns and goes on. It builds,
packs the four public packages, runs the style guard over each packed README, stages the two
install scripts with a `.sha256` beside each, writes
`SHA256SUMS` over the tarballs and the scripts, installs the packed files into an empty project outside
the repository, checks that every file their manifests name is there and `binference --version`,
writes npm's CycloneDX SBOM of that install and the notes from the commit subjects, and runs
`npm publish --dry-run` on each tarball. It publishes nothing. Read
`reports/release/<version>/notes.md`. A breaking change must have its `Breaking:` paragraph.

Then run the built-package smoke on the same files, which the workflow runs on macOS (decisions
0354 and 0449): the installed `binference` sets up, starts, trades on paper by chat and
stops, in about half a minute. It needs the network for BNB Smart Chain's RPCs and KyberSwap.

```sh
pnpm release:smoke reports/release/2026.11.0-beta.1
```

Then run `vet-release`'s checklist (decision 0063) for this commit: the fork and crash suites, the
install smoke test, the update from the previous stable and the agent evaluation. A `no` stops
the release.

## 4. Sign and push the tag

```sh
git tag -s v2026.11.0-beta.1 -m "binference 2026.11.0-beta.1"
git tag -v v2026.11.0-beta.1
```

The key is an SSH key listed in `.github/release-signers`, with git's `gpg.format` set to `ssh`
and `gpg.ssh.allowedSignersFile` pointing at that file for the check. Push the tag only on the owner's word;
the push starts `release.yml` as a dry run. Read
its summary and its checksums: they must match your local dry run's.

## 5. Publish by hand

Only with the owner's word: run `release.yml` by hand with `tag` and `publish` on. The run checks
the tag's signature and that `master` holds it, then waits for the `release` environment's
approval. npm publishes the dry run's tarballs, and the GitHub release gets the notes, tarballs,
`SHA256SUMS`, the SBOM, and `install.sh` with its `.sha256` (not `install.ps1`). A run that stops
halfway runs again: the npm job skips a version npm holds already.

The npm job reads each package on npm before it publishes it (decision 0451). A package npm holds
publishes through trusted publishing alone. A package npm has never held publishes once with
`NPM_BOOTSTRAP_TOKEN`, a secret of the `release` environment: an npm granular access token that
may publish packages of the `@binference` scope, with the shortest expiry npm offers. Without the
secret the job stops before that package and names it; add the secret and run it again. After the
first publish, for each new package on npmjs.com: set its trusted publisher (repository
`bInference-Lab/bInference`, workflow `release.yml`, environment `release`), turn on "Require
two-factor authentication and disallow tokens", then delete the token on npm and the secret in
the `release` environment.

`scratch` on is a test: npm's `scratch` dist-tag and a draft GitHub release. The version it uses is
gone for good.

Then host the install scripts (decision 0357), only with the owner's word: copy `install.sh`,
`install.ps1` and their `.sha256` files from the dry run's folder to binference.io, unchanged.
Serve all four as `text/plain; charset=utf-8`: Windows PowerShell reads a script with no charset
as ISO-8859-1 and garbles its Chinese lines. `SHA256SUMS`, which the release carries, lists both
scripts too. `install.ps1` is not hosted until the nightly one-liner job has passed once on
Windows; until then, host `install.sh` alone.

## 6. Never

- Publish from a laptop, or with a registry login. Only `release.yml` publishes, with provenance:
  through trusted publishing, or once per package npm never held with `NPM_BOOTSTRAP_TOKEN`
  (decision 0451).
- Publish a package npm holds with a token, or keep `NPM_BOOTSTRAP_TOKEN` once every package has
  its trusted publisher.
- Publish an unsigned tag, a tag signed by a key `.github/release-signers` does not list, or a tag
  `master` does not hold.
- Move, delete or reuse a pushed release tag, or unpublish a version.
- Push a tag, run the publish or turn on a workflow without the owner's word.
- Edit `release.json` or a tarball between the dry run and the publish.
- Publish a nightly pack (`-nightly.N`). Its manifests are private, and the npm job's publish check
  refuses it (decision 0354).

## 7. Report

The tag, the commit, the channel, each tarball with its size and SHA-256, the run's link, what was
published where, and `vet-release`'s answer. Name anything you could not check.
