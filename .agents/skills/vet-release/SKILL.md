---
name: vet-release
description: Checks a published or candidate binference release against the release checklist, the npm registry and a fresh install, and reports yes or no with the evidence. Use when asked whether a version is out, complete or safe to promote. It changes nothing.
---

# Vet a release

A release reaches owners who run it next to their money. It is out only when every item below
holds for the exact version, read from the live sources, not from a local checkout or the notes.

## 1. Pin the version

- Versions are calver `YYYY.M.PATCH`, on the `stable` or the `beta` channel. Write out the full
  version and the channel before you check anything.
- All four public packages carry that one version: `binference`, `@binference/protocol`,
  `@binference/client` and `@binference/plugin-sdk`. Every other package is private.
- Read the tagged source in a scratch folder (`git worktree add <dir> <tag>`), never your working
  copy.

## 2. The checklist

Decision 0063 in `docs/DECISIONS.md` sets what each release passes. Find each item's evidence for
this version:

- the fork suite and the crash suite green on the tagged commit (`fork.yml`, `crash.yml`), with
  the crash suite on all three OSes;
- the install smoke test (step 4);
- an update from the previous stable version (step 5);
- the agent evaluation at its bar: every safety scenario passes and at least 90% of the
  understanding scenarios, in English and in Chinese;
- a live Telegram run when the release touches ingress (`test-telegram`);
- each venue and feature labeled experimental, beta or stable in the notes;
- a config migration for every breaking config change, and a protocol version bump for every
  breaking protocol change.

## 3. The registry

```sh
npm view binference@<version> version dist-tags dist.integrity time --json
npm view @binference/protocol@<version> version
npm view @binference/client@<version> version
npm view @binference/plugin-sdk@<version> version
```

- The channel's dist-tag points at the version. A version on npm is never replaced: a mistake
  ships as the next patch.
- In a scratch project that installs the version, `npm audit signatures` passes: the packages
  carry registry signatures and provenance from the release workflow, never from a laptop.
- The tarball holds `NOTICES.md` and `LICENSE` (`npm pack binference@<version> --dry-run`).
- The release on GitHub has a signed tag (`git tag -v <tag>`) and a CycloneDX SBOM attached
  (`gh release view <tag> --json assets`).

## 4. The install smoke test

In a scratch home, never the owner's:

```sh
export BINFERENCE_HOME="$(mktemp -d)"
npx --yes binference@<version> --version
npx --yes binference@<version> --help
```

Then set up an install in paper mode with a test bot and no real funds, start it, run
`binference status`, `binference health` and `binference check`, and stop it. Stop means the
service is gone and nothing listens on the engine's port.

## 5. The update from the previous stable

In a fresh scratch home, install and start the previous stable version, make one paper trade, then
update to the candidate as the release notes tell owners to. The update takes a backup first, the
migrations run, `binference check` passes, and the paper trade is still in the ledger. Then
restore the backup and check that the previous version starts on it.

## 6. Report

Start with `yes` or `no`. Then one line per item of section 2, the registry facts of section 3,
the commands of sections 4 and 5 with what they showed, and what you cleaned up. Name every item
you could not check and why. Never print a token or a key.
