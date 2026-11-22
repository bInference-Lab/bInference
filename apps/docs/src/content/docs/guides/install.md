---
title: Install binference with one command
description: Install Node 26 and binference on your Mac with one line, check the script first if you want, set it up without questions, and remove it again.
---

binference supports macOS for now. One line installs binference and starts its setup. The script
installs Node 26 when your Mac has no Node 26.1 or later, installs the `binference` package from
npm, writes a `binference` command, then runs `binference init`, which asks you what it needs. It
never asks for root or administrator rights, and it never changes your shell's startup files or
your PATH by itself.

On any other system, the script says that binference supports macOS for now and stops before it
downloads anything.

## Install

binference is in beta. Open Terminal and run:

```sh
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

Without `--beta`, the script installs from the stable channel. Then follow
[Get started](/guides/getting-started/) through the setup.

## Check the script before you run it

Each release's `SHA256SUMS`, published with its signed GitHub release, lists the script. Download
the script and that file, check the sum, read the script, then run it:

```sh
curl -fsSLO https://binference.io/install.sh
curl -fsSLO https://github.com/bInference-Lab/bInference/releases/download/v2026.11.0-beta.1/SHA256SUMS
shasum -a 256 -c --ignore-missing SHA256SUMS
sh install.sh --beta
```

Put the tag of the release you install in the second line. A beta is a prerelease on GitHub, so
`releases/latest` does not reach it.

binference.io also serves `install.sh.sha256` beside the script. It shows the download is whole;
only `SHA256SUMS` from the release shows that the release made it.

## What the script does

Everything goes into one folder of yours, `~/.local/share/binference`, or `binference` under
`XDG_DATA_HOME` when you set it.

1. **Node.** When `node` on your PATH is Node 26.1 or later with its own npm beside it, the script
   uses it. Otherwise it downloads one Node 26 release from nodejs.org, the one the script pins
   (26.13.0 in the first beta), and checks the archive's SHA-256 against the value written in the
   script, which comes from Node's signed sums. If the two differ, it stops before it unpacks
   anything. Node goes into `node/` in that folder, with a `node/current` link to it, and the script
   checks that it runs. Apple silicon and Intel Macs each get their own build.
2. **binference.** It runs `npm i -g binference@beta`, or `binference@latest` on the stable
   channel, into `npm/` in that folder, so nothing needs `sudo`.
3. **The command.** It writes `bin/binference`, which runs binference with that Node by its full
   path. Only this command goes on your PATH, never Node or npm, so your other projects keep their
   own Node.
4. **PATH.** When `bin/` is not on your PATH, the script prints the line to add to your shell's
   startup file, such as `~/.zshrc`. Add it yourself, then open a new terminal. The line stays the
   same when a later run installs a newer Node.
5. **Setup.** It runs `binference init`. Without a terminal to answer in, it says so and stops; run
   `binference init` in a terminal when you are ready.

binference keeps its own state, the config, the databases, the keys and the logs, in a second
folder that `binference init` makes: `~/.binference`.

The script prints every message in Simplified Chinese when your locale is Chinese (`LANG` or
`LC_ALL`; Traditional Chinese locales get Simplified Chinese too), and in English otherwise.

## Set up without questions

For a script, pass `--yes`. The script then runs `binference init --yes`, which asks nothing. It
takes each answer from a `BINFERENCE_INIT_*` variable or from an answers file that
`BINFERENCE_INIT_ANSWERS` names, never from the script's command line:

```sh
curl -fsSL https://binference.io/install.sh | \
  BINFERENCE_INIT_ANSWERS="$HOME/answers.json5" sh -s -- --beta --yes
```

Secrets are never given as plain text: an answer such as the model key is a secret source, as
`config.json5` writes one. If an answer is missing, init names its flag, its variable and its key
in the answers file, then stops, and the script ends with init's exit code.

## Flags and variables

| Flag          | Variable                          | What it does                                                 |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| `--beta`      | `BINFERENCE_INSTALL_CHANNEL=beta` | Installs from the beta channel                               |
| `--yes`       | `BINFERENCE_INSTALL_YES=1`        | Runs `binference init --yes`                                 |
| `--skip-init` | `BINFERENCE_INSTALL_SKIP_INIT=1`  | Installs only; run `binference init` later                   |
|               | `BINFERENCE_NODE_MIRROR`          | Downloads Node from an https:// mirror; the sums still check |

`BINFERENCE_INSTALL_YES` and `BINFERENCE_INSTALL_SKIP_INIT` take `1` or nothing. Init's answers go
in `BINFERENCE_INIT_*` variables. `BINFERENCE_INSTALL_PACKAGE` names a local package file, for
tests only.

## When it stops

Every stop names the next step. The common ones:

- **Not macOS.** On Linux, Windows or any other system, binference supports macOS for now. Nothing
  was downloaded or installed.
- **The Node archive's SHA-256 differs.** Your network or mirror served other bytes than Node
  published. Nothing was installed. Try again on another network, or unset
  `BINFERENCE_NODE_MIRROR`.
- **Node cannot run here.** The downloaded Node failed to start, often on an older macOS. The
  script removes it; install Node 26 yourself, then run the script again.
- **npm could not install binference.** npm's own error is above the message. Check your network
  and npm's registry setting.

## Uninstall

```sh
binference uninstall
```

It stops binference, removes its background service, then the program: the launcher, the package
and the Node the script put in `~/.local/share/binference`. A Node you had before stays. It asks you
to type `uninstall` first; `--yes` skips the question.

The state folder `~/.binference` stays. `binference uninstall --state` removes it too, with
binference's keychain entries. Your wallets and what they hold stay in Privy. Once the state folder
is gone, only your owner key moves their tokens, so move everything to your rescue address with
`binference rescue` first, or keep your owner key to set up again with `binference init --attach`.

If you added the PATH line, the command prints it; remove it from your shell's startup file.

## Hosting the script

Whoever hosts binference.io serves `install.sh` and `install.sh.sha256` exactly as a release's dry
run staged them, as `text/plain; charset=utf-8`.
