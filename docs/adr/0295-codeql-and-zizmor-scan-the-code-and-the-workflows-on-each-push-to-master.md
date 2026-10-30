# 0295. CodeQL and zizmor scan the code and the workflows on each push to master

Status: Accepted

## Context

`docs/ENGINEERING.md` section 13 names CodeQL and zizmor as required CI jobs beside the audit,
OpenGrep and actionlint, but no workflow ran either. binference moves its owner's funds, so a
missed injection in the code or a loose permission in a workflow costs more here than in most
projects. CI runs on pushes to `master`, by hand and each night (decision 0294). The repository is
public, so code scanning costs no money, only Linux minutes.

A first zizmor run over the workflows found two kinds of finding: every workflow granted
`permissions: read-all`, and the three steps that call the shared `pushed-base` action used
`./.github/actions/...` where zizmor suggests GitHub's newer `$/...` form. The pinned actionlint
refuses that form.

## Decision

- **CodeQL** runs in its own workflow, `codeql.yml`, on each push to `master`, by hand and every
  Monday, so new queries also reach code that has not changed. It reads TypeScript and JavaScript
  from source (`build-mode: none`) with the `security-extended` queries, skips built output, and
  uploads to code scanning. Its one job holds `security-events: write`; nothing else does.
- **zizmor** runs in the existing security job of `ci.yml`, offline, after actionlint, from a
  release binary pinned by version and checked against its published SHA-256. Any finding fails
  the job. `.github/zizmor.yml` disables an audit only with its reason written beside it; the
  self-repository audit is off until actionlint accepts `$/...`.
- **Every workflow grants `contents: read`** instead of `read-all`. A job that needs more names it
  at the job with a comment.

Jobs after this decision:

| Event               | `ci.yml` | `codeql.yml` | `mutation.yml`                  | Nightly |
| ------------------- | -------- | ------------ | ------------------------------- | ------- |
| A push to `master`  | 11       | 1            | 1 when engine or signer changed | 0       |
| A night (every day) | 0        | 0            | 0                               | 34      |
| Monday              | 0        | 1            | 0                               | 34      |

## Consequences

- A push to `master` starts 12 jobs, 13 with the mutation job. CodeQL runs on Linux alone, in
  parallel with the rest, within its 30-minute timeout; zizmor adds a few seconds to the security
  job.
- CodeQL's alerts appear in the repository's code scanning view, not as a failed job. A new High
  alert on `master` is fixed or dismissed with a written reason before the next push.
- A workflow change that adds a permission, an unpinned action or a template injection fails CI.
- Workflows can no longer read issues, pull requests or packages through their token; none did.

## Alternatives

- **Drop both from the rule.** OpenGrep and Oxlint cover part of what CodeQL finds, but not its
  data-flow queries across files, and nothing else reads the workflows' permissions and injections.
- **CodeQL's default setup instead of a workflow.** It cannot be reviewed or pinned in the
  repository, and it runs on pull requests, which decision 0294 ruled out.
- **zizmor online.** Its online audits need a token in the job and reach the network; the offline
  audits cover every rule that reads the repository's own files.
