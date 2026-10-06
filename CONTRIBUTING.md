# Contributing to binference

This page covers how to set up the repository, how a change goes from an issue to `master`, and
what a pull request must pass. People and coding agents follow the same rules: the short form is in
[AGENTS.md](AGENTS.md), and the full set is in [docs/ENGINEERING.md](docs/ENGINEERING.md).

## Set up the repository

You need Node 26.1 or later. pnpm switches itself to the version the repository pins.

```sh
pnpm install
pnpm setup
pnpm check
```

- `pnpm install` installs the exact versions in the lockfile.
- `pnpm setup` links `.claude/skills` to `.agents/skills`, so coding agents find the skills.
- `pnpm check` runs every gate: format, lint, types, tests, the style guard and the repository
  checks. CI runs the same command on Linux, macOS and Windows, and all three must pass before a
  pull request merges.

## How a change flows

1. Open an issue before you build a feature, so the approach is agreed before the code.
2. Work on a branch named `<type>/<short-name>`, such as `fix/trailing-stop-restart`.
3. Keep one topic per pull request, at about 400 changed lines or fewer, tests and generated files
   not counted. A larger change becomes a stack of pull requests, each useful on its own.
4. Fill in the pull request template: the problem, the impact and the evidence. A change to
   `engine`, `signer`, `chain`, `chain-evm`, `chains` or `protocol` keeps the money-path checklist,
   ticked; a change to dependencies keeps the dependency section.
5. A change ships complete: tests, TSDoc on public exports, every new word in English and Chinese,
   and a decision record for a load-bearing decision ([docs/DECISIONS.md](docs/DECISIONS.md)).
6. One approval merges it. Pull requests are squash-merged, and the title becomes the commit
   subject on `master`.

## Write commit subjects

The pull request title is the commit subject, and the release notes are written from those
subjects. Follow the Commits section of [AGENTS.md](AGENTS.md#commits); the full rules are in
[section 19 of the engineering rules](docs/ENGINEERING.md#section-19).

## Add a dependency

- Choose the latest release that is at least 7 days old. pnpm refuses anything newer.
- Write the exact version in the catalog in `pnpm-workspace.yaml`; a `package.json` refers to it
  as `catalog:`.
- Install scripts stay off. A package that needs one is listed under `allowBuilds` in
  `pnpm-workspace.yaml` after review, and so is a package whose script is refused.
- In the pull request, state the job the dependency does, what else you considered, and why a Node
  built-in does not do it.

## Work with a coding agent

Claude Code, Codex, Cursor and other coding agents read [AGENTS.md](AGENTS.md), and the
`AGENTS.md` of each package they open. The skills in `.agents/skills/` run the review steps: run
`clean-diff` and then `review-diff` on every change before you open a pull request. Code from a
coding agent passes the same gates as code from a person.

## Report a security problem

Never report a security problem in a public issue. [SECURITY.md](SECURITY.md) says how to report it
privately.

## License

binference is released under the [MIT license](LICENSE), and contributions are accepted under it. There is no
contributor agreement to sign.
