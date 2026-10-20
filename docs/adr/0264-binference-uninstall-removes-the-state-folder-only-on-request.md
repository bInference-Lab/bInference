# 0264. binference uninstall removes the state folder only on request

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

ARCHITECTURE.md section 24 lists `binference uninstall`, and decision 0141 left it for later with
"the state folder and the keys too". Every install path ends in `npm i -g binference`
(decision 0054). The state folder holds the config, both databases, `keys/`, the logs and the local
backups. In the `keychain` unlock mode the agent key and the Privy app secret sit in the OS
keychain under the service `binference`, outside the state folder; together they sign inside the
ceilings. The wallets live in Privy; the owner key, shown once by `init` and kept offline, is never
on the machine. A live intent in `executing` may have a transaction on its way, which only the
engine's records can follow. Windows keeps the files of a loaded native module open, and the
program loads one (the keychain library).

## Decision

- `binference uninstall [--state]` runs its steps in order and stops at the first that fails. It
  stops the engine as `binference stop` does and removes the background service as
  `binference service remove` does. Then it removes the state folder when `--state` asks, and the
  program last.
- At a terminal it shows the plan and asks the owner to type a phrase in their language
  (`uninstall`, or its Chinese word). With nobody at the terminal, or with `--json`, it goes on only
  with `--yes`.
- With `--state` it first says, in the owner's language, that the wallets stay in Privy, that only
  the owner key moves their tokens once the folder is gone (`binference init --attach`, or a rescue
  before uninstalling), that the owner key is the code `init` showed once and kept offline, not in
  the state folder, and that local backups go with the folder while copies in `backups.copyTo`
  stay.
- `--state` refuses while a live intent is `executing`: the running engine is asked before
  anything changes, and `engine.sqlite` is read again once the engine stopped.
- The state folder is removed whole only when it holds `config.json5` or `engine.sqlite` and is
  neither the home folder nor a folder that holds it. With it go the keychain entries of the
  install: each entry the config names as `{ fromKeychain }`, and the agent key in the `keychain`
  unlock mode; an entry the keychain does not answer for stays.
- Then it says, in the owner's language, where the agent key is now (the lead's call,
  2026-10-20): gone with the folder in the `file` and `manual` modes; removed from the OS keychain,
  or still there under its entry when the keychain did not remove it, in the `keychain` mode; and
  in the `command` mode still where the command reads it, named by the program's file name alone,
  never its folder or arguments. No secret is printed.
- The program is removed with `npm uninstall --global --prefix <prefix> binference`, the prefix read
  from where the running script sits. On Windows the command is printed for the owner to run once
  this one ends. A program that npm did not install, such as a checkout, is left as it is.
- `--json` prints `{ service, state, keychain, program }`. It exits 1 when a step failed or it
  refused, else 0.

## Consequences

- One command takes binference off a machine on every OS, and the machine keeps no key that signs
  for the wallets. The wallets still list this machine's agent key as their signer on Privy; no
  copy of it is left, and `binference init --attach` replaces it. In the `command` unlock mode the
  agent key stays where the owner's command reads it, and the owner is told to remove it there.
- The CLI host can pass its own keychain and program runner, so tests never touch the OS keychain
  or run npm.
- A Windows owner runs one more command.

## Alternatives

- **Print the npm command on every OS.** One more step for every owner where the OS allows the
  removal. Rejected.
- **A detached process that removes the program on Windows after the command exits.** Its outcome
  would reach nobody. Rejected.
- **Leave the keychain entries.** The agent key and the app secret would still sign inside the
  ceilings from this machine. Rejected.
- **Remove the state folder by default.** One mistyped command would lose the history and the local
  backups. Rejected.
