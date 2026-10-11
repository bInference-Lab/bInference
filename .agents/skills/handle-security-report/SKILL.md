---
name: handle-security-report
description: Weighs a private security report or a leaked secret against binference's trust model and released versions, and drafts the maintainers' answer. Use on a GitHub security advisory, a secret scanning alert, or a key, token or seed phrase found in an issue, a pull request, a log or a commit.
---

# Handle a security report

binference signs transactions, so a real report can cost owners funds. Take each one seriously,
and close one only with evidence. Work on one report at a time; a maintainer posts every reply.

## 1. A leaked secret comes first

If the report or an alert shows a live secret, act before anything else:

- **Rotate it** with its owner: a bot token at BotFather, a Privy app secret in Privy's
  dashboard, a venue key at the venue, a paid RPC key at its provider. A machine's agent key is
  removed from every wallet with `binference signer revoke`, signed with the owner key.
- **Remove the text** where it shows: edit the issue or pull request body, delete and post again a
  comment, with `[REDACTED <kind>]` in place of the value. Never keep part of the value. A secret
  in a commit stays in history: rotation is the fix, not a rewrite.
- **Never copy the value** into a file, a test, a comment, a log, a shell command or your reply.
  Read alerts with the value hidden (`gh api ... secret-scanning/alerts/<n>?hide_secret=true`).
- Close the alert as revoked once the secret is rotated.

## 2. Read before you judge

1. `SECURITY.md` and the threat table in `docs/ARCHITECTURE.md` section 18.
2. The report itself: `gh api repos/{owner}/{repo}/security-advisories/<ghsa-id>`.
3. The code the report names, at the version the reporter ran.
4. Which releases hold the problem: `git tag --contains <commit>`, `git show <tag>:<path>`, and
   `npm view binference versions --json` for what owners can install.
5. Earlier advisories and issues on the same class of problem.

## 3. Judge it against the trust model

The model in `SECURITY.md` is the yardstick:

- **Keys and custody.** Wallet keys live in Privy. The machine's agent key can only ask Privy for a
  signature inside the wallet's ceiling, and only until the owner key removes it. A report that
  lets a machine sign outside the ceiling, to an address the owner did not save, or for a contract
  or spender no enabled venue declares, breaks the core promise.
- **The signer.** Only the signer process holds the agent key, and its hard rules refuse what the
  engine should never ask. A way to reach a signature without a confirmation, or after it
  expired beyond the stuck-step rule, is critical.
- **Confirmations.** Every transaction needs the owner's tap, collected by the engine, bound to the
  terms. A forged press, a card that shows other terms than it signs, or an MCP or agent path to
  `confirm` is critical.
- **Inside the boundary already.** A report that first needs the owner's unlocked machine, the
  owner's Telegram account or an installed plugin the owner chose describes a threat the model
  names; check whether its documented limit (the ceiling, the daily caps, the freeze) still holds.
- **Secrets at rest and in logs.** Any key, seed, token or prompt in a log, an error, a URL or a
  command line is a bug, whatever else the attacker needs.

## 4. Decide

- **Valid:** keep it open, fix it in a private fork of the advisory, and publish after a release
  carries the fix. Fixed on `master` but not yet released is still open.
- **Valid, narrower:** keep it open and state the real impact and severity.
- **Out of scope:** the model already names the threat and its limit holds. Close with the
  sentence of `SECURITY.md` that covers it.
- **Not reproducible or duplicate:** close with the evidence or the earlier advisory.

A hardening idea that the decision does not need is a separate issue, and only when it keeps every
flow owners use.

## 5. Write the reply

Plain and firm: the decision, the code it rests on, the versions affected and the fixed version.
Public advisory text names the fixed version only: no commit hashes, no pull request numbers and
no account of how the fix works. Thank the reporter and keep their credit.

## 6. Report

The advisory link, the decision, the evidence, the versions affected, and the draft reply for a
maintainer to post. Never post it yourself.
