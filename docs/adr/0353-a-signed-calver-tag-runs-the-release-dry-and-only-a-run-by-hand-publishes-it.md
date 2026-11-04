# 0353. A signed calver tag runs the release dry, and only a run by hand publishes it

Status: Amended by 0354

Accepted by the tech lead on 2026-11-04.

## Context

Nothing has been released. Decision 0063 sets calver `YYYY.M.PATCH` on a `stable` and a `beta`
channel and never replaces an npm version. ENGINEERING section 13 publishes npm packages only from
CI with provenance through trusted publishing, signs release tags and ships a CycloneDX SBOM per
release; section 19 writes the release notes from the commit subjects on `master` and asks for a
version format check. Decision 0292 publishes the image to GitHub's registry for amd64 and arm64
with an SBOM. Decision 0294 runs CI on pushes to `master` only, and decision 0295 gives each
workflow `contents: read` and checks it with zizmor. Neither the npm organization, a trusted
publisher, a release key nor GitHub Actions is set up yet.

## Decision

- **Tags and channels.** `vYYYY.M.PATCH` is a stable release and `vYYYY.M.PATCH-beta.N` a beta,
  with no leading zeros and a month from 1 to 12. A beta orders before the release it leads to,
  as npm orders it. Stable publishes to npm's `latest` dist-tag, which `npm i -g binference`
  reads, and beta to `beta`; the image gets the version's tag and `latest` or `beta`.
- **One dry run, run alike everywhere.** `pnpm release:dry <tag>` refuses a tag outside these
  forms, a working tree with changes, a tag that names another commit than HEAD, and a version not
  newer than every release tag in the repository. It then builds, packs the four packages
  (decision 0352), runs the style guard over each packed README, writes `SHA256SUMS` over the
  tarballs, installs the packed files into an empty project with install scripts off, checks that
  `binference --version` prints the version and that each package loads, writes the CycloneDX
  SBOM npm reads from that install, writes the notes, and runs `npm publish --dry-run` on each
  tarball. It publishes nothing. A maintainer runs it before tagging; the workflow runs the same
  command. The `release` skill walks a maintainer through it.
- **Release notes.** The subjects since the previous release tag on HEAD's history, without merge
  commits: breaking changes first with their `Breaking:` paragraph, then new features, fixes,
  speed and other changes, each heading in English and Simplified Chinese. The first release
  counts its commits instead of listing them; `--since <ref>` starts the notes elsewhere.
- **`release.yml`.** A pushed tag `v*` runs it dry: the dry run, a smoke job that installs the
  downloaded tarballs on its own runner, and the image built for linux/amd64 and linux/arm64 with
  BuildKit's SBOM and provenance, pushed nowhere. The artifacts stay on the run for 30 days.
- **Publishing only by hand.** A run by hand with `publish` on first checks that the tag is signed
  by an SSH key `.github/release-signers` lists and that `master` holds it. npm publishes the
  tarballs the dry run summed, through trusted publishing in the `release` environment, with no
  npm token anywhere and a version npm holds already skipped. The image is then pushed to
  `ghcr.io/<owner>/binference`, and a GitHub release gets the notes, the tarballs, `SHA256SUMS`
  and the SBOM, marked a prerelease for a beta. `scratch` on publishes to npm's `scratch`
  dist-tag, pushes only the version's image tag and leaves the GitHub release a draft.
- **Permissions.** The workflow holds `contents: read`. Only the npm job holds `id-token: write`,
  only the image job `packages: write`, and only the GitHub release job `contents: write`. No job
  restores a cache, so no cached file reaches a release.
- **The built-package smoke test grows in place.** `pnpm release:smoke <folder>` and the workflow's
  smoke job are where it adds its checks.

Jobs:

| Event                  | `release.yml`                             |
| ---------------------- | ----------------------------------------- |
| A pushed release tag   | 3: dry run, smoke, two-platform image     |
| A run by hand, dry     | 3                                         |
| A run by hand, publish | 5: the three, npm, and the GitHub release |

## Consequences

- A tag can be dry-run on GitHub before anything is public, and a maintainer can run the same dry
  run locally from HEAD before the tag exists.
- The owner sets up, before the first publish: the npm organization `binference` and the
  unscoped name `binference`, a trusted publisher for each of the four packages naming this
  repository, `release.yml` and the `release` environment, publish tokens off, the release key in
  `.github/release-signers`, the `release` environment's reviewers, and GitHub Actions on.
- npm and the image publish one after the other; a run that stops between them is run again, and
  the npm job skips what is already there.
- The arm64 image builds under QEMU on an amd64 runner, which takes longer than a native build; the
  job's timeout is 60 minutes.
- A release tag pushed from the GitHub UI or a branch that `master` does not hold never publishes.

## Alternatives

- **Publish on every pushed tag.** A tag pushed by mistake would publish versions npm never lets go
  of; a run by hand with an input that defaults off is the one deliberate step.
- **Stable to a `stable` dist-tag.** `npm i -g binference` reads `latest`, and trusted publishing
  cannot add a second dist-tag without a token.
- **GPG-signed tags.** A GPG check needs a keyring on the runner; git checks SSH signatures against
  a committed file with `ssh-keygen` alone.
- **Build the image on native arm64 runners.** Two jobs and a manifest merge, for a workflow that
  runs a few times a month.
- **syft for the SBOMs.** npm writes CycloneDX from the packed install, and BuildKit attaches the
  image's SBOM; a third tool adds a download to pin.
