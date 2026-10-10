# 0141. binference service remove takes a replaced machine off login

Status: Accepted

## Context

`binference start` installs the background service, and `binference stop` stops the engine but
keeps the service for the next login ([decision 0138](../DECISIONS.md#d0138)). Once another machine
attaches, or the owner key revokes this machine's agent key, the old machine's service still starts
its engine at every login. That engine stays locked with `signer_revoked`, signs nothing and leaves
the bot alone ([decision 0140](../DECISIONS.md#d0140)), but it runs, reads Privy at each start and
keeps the old state folder busy. No command removes the service: `binference uninstall` is planned
with a wider job (the state folder and the keys too), and the owner would otherwise need
`launchctl`, `systemctl --user` or `schtasks` by hand. The platform's `ServiceManager` already has
`uninstall(name)` on all three OSes.

## Decision

- `binference service remove` stops the engine if it runs, then removes the background service
  through the platform's `ServiceManager`. It keeps the state folder, the config and the keys, so
  the owner can still read the old history or attach this machine again. A machine with no
  service, or a state folder `BINFERENCE_HOME` moves, which never has one, stops its engine and
  says no service was there; running it twice is safe.
- It needs no owner key: it changes nothing on Privy and nothing a wallet can sign.
- The summaries of `binference init --attach` and `binference signer revoke` name it as the step
  to run on the old machine.
- `binference uninstall` stays a later decision; it calls the same removal first.

## Consequences

- A replaced machine leaves login in one command on every OS, and the CI login job gains a case.
- A new command and its messages in English and Chinese; the glossary gains no new term.

## Alternatives

- **`binference stop --remove`.** One more flag on a command whose meaning decision 0138 fixed:
  stop keeps the service. Rejected.
- **The revoked engine removes its own service.** A wrong Privy answer, or a revoke the owner did
  not mean, would silently take the owner's service off login. Rejected.
- **Wait for `binference uninstall`.** Until then the owner edits login items by hand, which the
  flow could only explain per OS. Rejected.
