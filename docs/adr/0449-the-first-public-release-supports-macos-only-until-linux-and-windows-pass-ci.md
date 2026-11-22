# 0449. The first public release supports macOS only until Linux and Windows pass CI

Status: Accepted

Accepted by the owner on 2026-11-22.

Amends [decision 0354](0354-the-packed-packages-trade-on-paper-by-chat-on-every-os-nightly-and-before-each-publish.md),
[decision 0353](0353-a-signed-calver-tag-runs-the-release-dry-and-only-a-run-by-hand-publishes-it.md),
[decision 0293](0293-a-nightly-job-builds-and-runs-the-docker-image-on-linux-amd64.md) and
[decision 0292](0292-the-docker-image-runs-binference-as-its-own-user-on-a-state-volume.md).

## Context

binference has published nothing. The owner decided on 2026-11-22 that the first release is a
public beta on npm that supports macOS only, with no private alpha before it.

What each OS is proven on:

- Every smoke has run on macOS on Apple silicon: the packed install's paper trade by chat
  (`pnpm release:smoke`, decision 0354), the install one-liner (`pnpm install:smoke`, decision
  0357), the update with its rollback (`pnpm update:smoke`, decision 0356) and the owner's first
  day (`pnpm first-day:smoke`, decision 0359).
- Linux and Windows are proven only by CI jobs: `ci.yml`'s `pnpm check` and OS jobs, the smoke,
  one-liner and first-day rows of `packed.yml`, and the smoke rows of `release.yml`. GitHub Actions
  are off, so none of them has run, and `install.ps1` has never run.
- The Docker image runs Linux. `pnpm test:image` passes on a laptop; the nightly image job
  (decision 0293) and the release's two-platform image build (decisions 0292 and 0353) have never
  run.
- Decision 0354 publishes to npm only once the release smoke passes on Linux, macOS and Windows,
  so the first run of a Linux or a Windows row would decide a macOS release.
- Decision 0357 hosts `install.ps1` only once the nightly one-liner job has passed on Windows.

## Decision

- **macOS only.** The first public release, `2026.11.0-beta.1` on npm's `beta` dist-tag, supports
  macOS. npm still installs binference on Linux and Windows, where nothing supports or proves it.
- **The install script.** `install/install.sh` stops on any system but macOS before it downloads
  anything, with one line in English or Chinese, by the locale: binference supports macOS for now,
  and Linux comes in a later release. It exits 1. Its Linux code, the Linux Node pins among it,
  stays, so Linux returns by removing that one check.
- **`install.ps1`** stays in the repository, unhosted, as decision 0357 already holds until the
  Windows one-liner job passes. The dry run still stages it beside `install.sh`, and `SHA256SUMS`
  lists both.
- **The release smoke on macOS.** The smoke job of `release.yml` runs on `macos-latest` alone, and
  npm publishes once it passes. This amends decision 0354's smoke on three OSes before each
  publish; its nightly smoke on three OSes in `packed.yml` stays.
- **No image in the release.** `release.yml` builds and publishes no image, and the GitHub release
  waits for none. This amends the two-platform image job of decision 0353 and the publishing to
  GitHub's registry of decision 0292, which decision 0293 counts on. `release.json` still names
  the image tags; the dry run no longer prints them. The nightly image job of decision 0293 stays
  as it is.
- **The smokes off macOS.** On Linux, `pnpm install:smoke` runs one case: the one-liner stops with
  that line before it asks for Node or the package. `pnpm first-day:smoke` on Linux records its
  install step as `refused` once the one-liner stops so, and runs no later step, as it records
  `update` on Windows. The nightly Linux rows then prove the refusal.
- **The words.** The README in English and Chinese, the docs site's home page, its install guide
  and a new getting-started guide say binference supports macOS for now. The feature guides drop
  their Linux, Windows and Docker lines. The Docker and server guide stays at
  `apps/docs/src/content/docs/guides/docker-vps.md` and its Chinese twin, marked `draft: true`, so
  the site's build leaves it out; the sidebar and the other pages stop linking it.
- **An OS returns** in the release whose commit passes, on that OS, the `pnpm check` and OS jobs of
  `ci.yml` and the smoke, one-liner and first-day jobs of `packed.yml`. For Linux, that release
  removes the install script's check, puts the Linux row back in the release smoke, brings the
  release's image job back once the nightly image job has passed, and lifts the Docker guide's
  draft mark. For Windows, it puts the Windows row back and hosts `install.ps1` as decision 0357
  says.

Jobs:

| Event                  | Before                                 | After                                  |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| A pushed release tag   | 5: dry run, smoke on three OSes, image | 2: dry run, smoke on macOS             |
| A run by hand, publish | 7                                      | 4: the two, npm and the GitHub release |
| Each night             | 45                                     | 45                                     |
| A push to `master`     | 12                                     | 12                                     |

## Consequences

- The first public release waits on no CI row that never ran, and on no image that an owner of
  this release would run.
- The install script pins Node's Intel build for macOS too, but every smoke ran on Apple silicon,
  and GitHub's `macos-latest` runner is Apple silicon: Intel Macs stay unproven.
- A Linux or Windows owner who runs `npm i -g binference` gets a program nothing proved there; the
  docs name macOS only.
- The nightly jobs still run on all three OSes, so a fault in the packed program on Linux or
  Windows still shows there once Actions run; only the one-liner and the first day stop at the
  install script on Linux.
- The release skill and the CI skill say what the release workflow runs now.

## Alternatives

- **Keep the smoke on three OSes and turn Actions on first.** The first Linux and Windows runs would
  decide a macOS release, and a fault found there would hold macOS owners for an OS this release
  does not support.
- **Publish the image as a preview.** It runs Linux, which this release does not support, and an
  owner who pulls its tag keeps it after a later release fixes what it lacked.
- **Let the install script run on Linux with a warning.** It would install a program nothing proved
  there, next to the owner's money, from the script the docs present.
- **Remove the Linux code from the install script.** Linux would come back as new code to review,
  not as one removed check.
- **A private alpha first.** The owner chose a public beta.
