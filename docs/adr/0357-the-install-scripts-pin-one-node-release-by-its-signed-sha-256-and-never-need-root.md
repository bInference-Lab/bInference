# 0357. The install scripts pin one Node release by its signed SHA-256 and never need root

Status: Accepted

Accepted by the owner on 2026-11-04.

## Context

An owner installs binference with one line: `curl -fsSL https://binference.io/install.sh | sh`
on macOS and Linux, `irm https://binference.io/install.ps1 | iex` on Windows. binference needs
Node 26.1 or later, which most machines lack, so the script often installs Node before
`npm i -g binference` and `binference init`. The Node it installs runs the agent that holds the
owner's keys.

Facts that bound the choice:

- Node publishes `SHASUMS256.txt` beside each release, signed by its release team. Node's own
  README names the keyrings of the team's keys, kept in the `nodejs/release-keys` repository, to
  check that signature with `gpgv`; one ring holds every key that ever signed a release.
- Checking the signature at install time needs `gpg` on the owner's machine, which macOS and
  Windows do not have. Reading the sums file at install time without the signature trusts the
  same server the archive came from.
- A mirror (`NODEJS_ORG_MIRROR` in Node's own tools) helps owners whose network cannot reach
  nodejs.org.
- npm's global folder is often owned by root on Linux (`/usr`, `/usr/local`), and `sudo npm i -g`
  leaves root-owned files that a later update as the owner cannot replace.
- A folder put first on PATH changes every program found there: a Node folder on PATH moves the
  owner's other projects to that Node.
- Shell startup files and the Windows PATH are the owner's: an edit made without asking is hard to
  see and to undo.
- Windows PowerShell 5.1 reads a script fetched with `irm` in the response's charset, and
  ISO-8859-1 without one; it turns a native program's stderr into errors.

## Decision

- **One pinned release.** Each script holds one Node 26 release and the SHA-256 of each archive it
  may fetch: `tar.gz` for macOS and Linux on x64 and arm64, `zip` for Windows on x64 and arm64.
  The script downloads the archive into a temporary folder and compares its SHA-256 with the pin;
  a difference stops the script before anything is unpacked, and it says so with the next step.
  The unpacked Node must run `--version` before it is kept.
- **Pins from the signed file only.** `pnpm node:pins --version <26.x.y>` downloads the release's
  `SHASUMS256.txt` and its detached signature, checks it with `gpgv` against the keyring of every
  Node release key, and writes the pins into both scripts between `node-pins` markers. The keyring
  comes from one commit of `nodejs/release-keys`, and its SHA-256, both in
  `config/node-release-keys.json`; a keyring with any other SHA-256 stops it. Moving that commit is
  a reviewed change. `pnpm node:pins` alone re-reads the pinned release, fails when a pin differs,
  and names a newer Node 26 release. A job of its own in the nightly packed-install workflow and
  the release dry run's job run that check; nobody edits a pin by hand.
- **A mirror, never trusted.** `BINFERENCE_NODE_MIRROR` changes where the archive comes from; it
  must be `https://` (or `http://127.0.0.1`, for tests), and the pin still decides.
- **One folder of the owner's.** Everything goes under `~/.local/share/binference` on macOS and
  Linux and `%LOCALAPPDATA%\binference` on Windows: a Node the script installs in `node/` with a
  `current` link to the pinned release, the package in `npm/` through `npm i -g --prefix`, which
  changes no npm setting, and a launcher in `bin/`. The scripts never call `sudo` or ask for
  administrator rights.
- **A launcher, not Node, on PATH.** `bin/` holds only `binference` (`binference.cmd` on Windows),
  which the script writes on each run. It runs the package's entry with the chosen Node by its full
  path, through `node/current` for the pinned Node, or the real file of a Node 26 already on the
  machine, and with the Node flags the entry's first line names. `node`, `npm`, `npx` and
  `corepack` never reach the owner's PATH, and the folder's name never changes with a pin. The
  launcher is not a file of the repository, so the shell-file exception stays two files.
- **PATH printed, never written.** When `bin/` is not on PATH, the script prints the exact line to
  add, for the shell's startup file or for the user's PATH on Windows, keeping that PATH's
  `%VARIABLES%`, and changes PATH only in its own process.
- **Answers never on the command line.** The scripts take no init flags; `--yes` runs
  `binference init --yes`, which reads its answers from the `BINFERENCE_INIT_*` variables or an
  answers file, so no secret sits in a process list or a shell history.
- **The test-only package.** `BINFERENCE_INSTALL_PACKAGE` takes only an existing `.tgz` file by its
  full path, or an `http` address of a `.tgz` on `127.0.0.1`, `localhost` or `[::1]` with a port
  and no user, query or fragment. The script fetches it itself and refuses a redirect, then hands
  npm the file.
- **Hosting.** binference.io serves both scripts and their `.sha256` files as
  `text/plain; charset=utf-8`; the release's `SHA256SUMS` lists both scripts. `install.ps1`
  starts with a UTF-8 byte order mark, and is hosted only once the nightly one-liner job has passed
  on Windows. Around each native program it runs, it lets stderr through as text and judges the
  exit code.
- **Proof.** `pnpm install:smoke <folder> --fresh-node` serves a dry run's files on 127.0.0.1 in
  place of binference.io and runs the one-liner as the guide prints it, in a home of its own: a
  Node mirror with the wrong bytes must stop it before anything is unpacked, a Node 26 on PATH
  must be kept, the pinned Node must come from nodejs.org and pass its pin, and the packed
  `binference` must install, print its version through the launcher, and run `init --yes`, whose
  refusal line and exit code the script passes on. `packed.yml` runs it each night on Linux, macOS
  and Windows (Windows PowerShell 5.1), from the packed files its pack job already makes.
  `pnpm check:shell` runs shellcheck on `install.sh` where it is installed, and CI's security job
  runs it with a pinned shellcheck.

Jobs:

| Event              | Before | After                                               |
| ------------------ | ------ | --------------------------------------------------- |
| Each night         | 38     | 42: the Node pins check and the one-liner on 3 OSes |
| A push to `master` | 12     | 12; the security job adds a shellcheck step         |
| A release tag      | 5      | 5; the dry run checks the pins and stages scripts   |

## Consequences

- A compromised nodejs.org or mirror cannot change the Node an owner gets; it can only stop the
  install. The pins must be refreshed for a Node security release, and an owner who runs an old
  copy of the script gets the older Node.
- The install scripts change with each Node release they pin, so their published `.sha256` files
  and `SHA256SUMS` lines change too.
- `binference update` must install into `npm/` under the data folder and leave the launcher as it
  is, or write it again the way the script does.
- An owner who skips the PATH line must call the launcher by its full path in a new terminal; the
  script prints it.
- A Linux on musl (Alpine) gets no official Node build and is told to install Node 26 from its
  packages and run the script again; the launcher then runs that Node by its full path.
- A Node 26 from a version manager stays the launcher's Node by its real file, so switching the
  manager's version leaves binference on it until the script runs again.

## Alternatives

- **Read `SHASUMS256.txt` at install time.** It comes from the same server as the archive, so it
  proves the download is whole, not that Node made it.
- **Check the signature at install time.** It needs `gpg` on the owner's machine and the keyring
  download, which macOS and Windows lack.
- **The keyring of active keys, fetched from the repository's head.** It trusts whatever the head
  holds at that moment, and a releaser who leaves the active list turns an older pin's check red.
- **Install Node through the system's package manager.** Homebrew, apt and winget differ in version
  and often need root; the pinned archive is the same on every machine.
- **`sudo npm i -g`, or `npm config set prefix`.** The first leaves root-owned files; the second
  changes a setting the owner's other tools read.
- **Put the Node folder on PATH.** It moves the owner's other projects to that Node, and the line
  changes with each pin.
- **Append to `~/.zshrc` or set the user PATH.** Faster for the owner, but it edits files and
  settings that are not binference's without asking.
- **Init flags after `--`.** A secret given there sits in the process list and the shell history
  until init refuses it, and PowerShell drops the `--` itself.
