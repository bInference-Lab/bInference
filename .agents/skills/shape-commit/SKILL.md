---
name: shape-commit
description: Checks that staged work is one commit's worth, proposes a split when it is not, and writes the commit subject and branch name. Use before every commit and when choosing a pull request title.
---

# Shape the commit

Every pull request is squashed into one commit on `master`, and its title becomes the subject.
The release notes are written from those subjects.

## 1. Read what is staged

```sh
git diff --staged --stat
git diff --staged
```

Stage only the files the change needs.

## 2. One commit's worth

- One reason to exist. If the subject needs "and" to join two unrelated changes, split it.
- Complete: code, tests, TSDoc, English and Chinese messages, docs pages, the config migration and
  the ADR travel together.
- Apart, each in its own commit: a refactor or rename the feature needs (first), formatting-only
  changes, one dependency update, an unrelated fix found on the way.
- Together: a schema migration and the code that needs it; generated files and their cause.
- Over about 400 changed lines, tests and generated files left out: propose a stack of pull
  requests (ports and types, then the adapter, then the wiring), each green and useful alone.
- Nothing private: no secrets, `.env` files, keystores, local paths or internal notes.

When a split is needed, name each commit and the files it holds.

## 3. Type

| Type       | When                                                           |
| ---------- | -------------------------------------------------------------- |
| `feat`     | A user or developer can do something new                       |
| `fix`      | Behavior was wrong and is now right                            |
| `perf`     | Same behavior, measurably faster or lighter                    |
| `refactor` | Same behavior, better structure; existing tests pass unchanged |
| `test`     | Tests only                                                     |
| `docs`     | Documentation only                                             |
| `ci`       | GitHub workflows and CI scripts                                |
| `build`    | The toolchain, packaging and dependencies                      |
| `chore`    | Repo upkeep that is none of the above                          |
| `revert`   | Undoes an earlier commit on `master`                           |

When two fit, use the one the user notices.

## 4. Scope

One scope, never two: the package folder, the plugin folder, a feature folder of `engine` or
`runtime`, or one of `deps`, `skills`, `dev-skills`, `docs`, `release`. Pick the most specific
owner of the behavior. Leave the scope out only for a change across the repo.

## 5. Subject

`type(scope): description`, 72 characters at most.

- The description starts lowercase, has no period and says exactly what changed.
- A fix names the symptom the user saw, not the code that changed.
- No vague words, no dashes as punctuation, no emojis, no issue numbers, no task ids.
- A breaking change adds `!` and a body paragraph that starts with `Breaking:`.
- A revert reads `revert: <original subject>` with `This reverts commit <hash>.` in the body.
- A body, when a reviewer needs one, is a few plain paragraphs wrapped at 72 characters, with no
  headings and no checklists. No AI attribution lines.

## 6. Branch

`<type>/<short-name>`, such as `fix/trailing-stop-restart`.

## 7. Verify

```sh
printf '%s\n' "<subject>" | pnpm exec commitlint
pnpm check:style --text "<subject>"
```

Give the subject, the body if any, and the branch name.
