# 0451. A new npm package publishes once with a bootstrap token, then only through trusted publishing

Status: Accepted

Accepted by the tech lead on 2026-11-22.

Amends [decision 0353](0353-a-signed-calver-tag-runs-the-release-dry-and-only-a-run-by-hand-publishes-it.md).

## Context

Decision 0353 publishes the four public packages (decision 0352) from `release.yml` through npm's
trusted publishing in the `release` environment, with no npm token anywhere, and asks the owner to
set a trusted publisher for each package before the first publish.

npm sets a trusted publisher on a package's settings page on npmjs.com, which exists only once npm
holds the package. A publish through trusted publishing cannot create a package npm never held.

On 2026-11-22 npm holds `binference`, under the owner's account: versions `0.0.0-stage`, `0.1.0`
and `1.0.0`, with `latest` at `1.0.0`, an older setup program unrelated to this one.
`@binference/client`, `@binference/plugin-sdk` and `@binference/protocol` answer 404.

## Decision

- **Read first.** Before each publish, the npm job reads the package on npm. A version npm holds
  is skipped, as before. An answer other than the package or a 404 stops the job before that
  package, naming it.
- **A package npm holds** publishes only through trusted publishing, with `--provenance`, never
  with a token, whether or not a token is set.
- **A package npm never held** publishes once with `NPM_BOOTSTRAP_TOKEN`, a secret of the `release`
  environment: an npm granular access token that may publish packages of the `@binference` scope,
  with the shortest expiry npm offers. It publishes with `--provenance`, `--access public` and the
  channel's dist-tag. Only that one publish reads the token, through a user config file of its
  own; every other npm call runs without it.
- **No secret.** When a package npm never held meets a run without `NPM_BOOTSTRAP_TOKEN`, the job
  fails before publishing it, with a line naming the package and the next step: add the secret,
  then run the workflow again. What the run published before stays, and the next run skips it.
- **After the first publish,** the owner sets each new package's trusted publisher on npm
  (repository `bInference-Lab/bInference`, workflow `release.yml`, environment `release`), turns
  on "Require two-factor authentication and disallow tokens" for it, then deletes the token on
  npm and the secret in the `release` environment.
- **`binference`** is on npm already, so its trusted publisher is set before the first release,
  and it never takes the token.

## Consequences

- The first release publishes the three scoped packages with the token and `binference` through
  trusted publishing. All four carry npm provenance, which the job signs with its own OIDC
  identity either way.
- Until the owner deletes it, the token can publish new versions of the three scoped packages. It
  lives only in the `release` environment, whose reviewers approve each run.
- ENGINEERING section 13's "publish tokens off" holds from the owner's settings on; for the first
  publish of a package it does not.
- A public package added later takes the same route once.

## Alternatives

- **Publish the three new packages from a laptop once.** Only `release.yml` publishes; a laptop
  publish carries no provenance from the workflow and bypasses the tag and signature checks.
- **Publish a placeholder version by hand to create each package.** The placeholder stays on npm
  for good, since npm never takes a version twice, and it is a laptop publish with a token.
- **A token for every publish.** A long-lived publish token is what trusted publishing removes.
