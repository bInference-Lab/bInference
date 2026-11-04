---
title: Install binference with one command
description: Install Node 26 and binference on macOS, Linux or Windows with one line, check the script first if you want, and set it up without questions.
---

One line installs binference and starts its setup. The script installs Node 26 when your computer
has no Node 26.1 or later, installs the `binference` package from npm, writes a `binference`
command, then runs `binference init`, which asks you what it needs. It never asks for root or
administrator rights, and it never changes your shell's startup files or your PATH by itself.

## macOS and Linux

Open a terminal and run:

```sh
curl -fsSL https://binference.io/install.sh | sh
```

To install from the beta channel, pass `--beta`:

```sh
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

## Windows

Open PowerShell (Windows PowerShell 5.1 or PowerShell 7) and run:

```powershell
irm https://binference.io/install.ps1 | iex
```

To install from the beta channel, set the channel first:

```powershell
$env:BINFERENCE_INSTALL_CHANNEL = 'beta'; irm https://binference.io/install.ps1 | iex
```

## Check the script before you run it

Each release's `SHA256SUMS`, published with the signed GitHub release, lists both scripts. Download
the script and that file, check the sum, read the script, then run it:

```sh
curl -fsSLO https://binference.io/install.sh
curl -fsSLO https://github.com/bInference-Lab/bInference/releases/latest/download/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
sh install.sh
```

On macOS, use `shasum -a 256 -c --ignore-missing SHA256SUMS` in place of `sha256sum`. On Windows,
compare the hash PowerShell prints with the `install.ps1` line of `SHA256SUMS`:

```powershell
irm https://binference.io/install.ps1 -OutFile install.ps1
(Get-FileHash install.ps1 -Algorithm SHA256).Hash.ToLower()
powershell -ExecutionPolicy Bypass -File install.ps1
```

binference.io also serves `install.sh.sha256` and `install.ps1.sha256` beside the scripts. They
show the download is whole; only `SHA256SUMS` from the release shows that the release made it.

## What the script does

Everything goes into one folder of yours: `~/.local/share/binference` on macOS and Linux,
`%LOCALAPPDATA%\binference` on Windows.

1. **Node.** When `node` on your PATH is Node 26.1 or later with its own npm beside it, the script
   uses it. Otherwise it downloads one Node 26 release from nodejs.org and checks the archive's
   SHA-256 against the value written in the script. If the two differ, it stops before it unpacks
   anything. Node goes into `node/` in that folder, and the script checks that it runs.
2. **binference.** It runs `npm i -g binference` on the stable channel, or `binference@beta`, into
   `npm/` in that folder, so nothing needs `sudo`.
3. **The command.** It writes `bin/binference` (`bin\binference.cmd` on Windows), which runs
   binference with that Node by its full path. Only this command goes on your PATH, never Node or
   npm, so your other projects keep their own Node.
4. **PATH.** When `bin/` is not on your PATH, the script prints the line to add to your shell's
   startup file, or the PowerShell command that adds it to your user PATH. Run it yourself, then
   open a new terminal. The line stays the same when a later run installs a newer Node.
5. **Setup.** It runs `binference init`. Without a terminal to answer in, it says so and stops;
   run `binference init` in a terminal when you are ready.

The script prints every message in Simplified Chinese when your locale is Chinese (`LANG` or
`LC_ALL` on macOS and Linux, the display language on Windows; Traditional Chinese locales get
Simplified Chinese too), and in English otherwise.

## Set up without questions

For a server or a script, pass `--yes`. The script then runs `binference init --yes`, which asks
nothing. It takes each answer from a `BINFERENCE_INIT_*` variable or from an answers file that
`BINFERENCE_INIT_ANSWERS` names, never from the script's command line:

```sh
curl -fsSL https://binference.io/install.sh | \
  BINFERENCE_INIT_ANSWERS="$HOME/answers.json5" sh -s -- --yes
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
tests only. On Windows, set the variables in PowerShell before the `irm` line, as in the beta
example.

## When it stops

Every stop names the next step. The common ones:

- **The Node archive's SHA-256 differs.** Your network or mirror served other bytes than Node
  published. Nothing was installed. Try again on another network, or unset
  `BINFERENCE_NODE_MIRROR`.
- **No official Node build.** Alpine and other Linux systems on musl, and processors Node does not
  build for, need Node 26 from the system's packages first. Install it, then run the script again.
- **Node cannot run here.** The downloaded Node failed to start, often on an older system. The
  script removes it; install Node 26 from the system's packages, then run the script again.
- **npm could not install binference.** npm's own error is above the message. Check your network
  and npm's registry setting.

## Hosting the scripts

Whoever hosts binference.io serves `install.sh`, `install.ps1` and their `.sha256` files exactly as
a release's dry run staged them, as `text/plain; charset=utf-8`. Windows PowerShell reads a script
sent without a charset as ISO-8859-1, which garbles its Chinese lines.
