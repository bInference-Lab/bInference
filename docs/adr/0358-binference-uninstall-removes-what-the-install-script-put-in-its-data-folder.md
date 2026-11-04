# 0358. binference uninstall removes what the install script put in its data folder

Status: Accepted

Accepted by the tech lead on 2026-11-04: it applies the owner's uninstall order of decision 0264
(service, then state, then program) to what the install script put in place.

## Context

Decision 0264 removes the program with `npm uninstall --global --prefix <prefix> binference`, the
prefix read from where the running script sits. Decision 0357 installs binference with a one-line
install script into a data folder of the owner's: `~/.local/share/binference` on macOS and Linux,
`%LOCALAPPDATA%\binference` on Windows. The folder holds the npm prefix `npm/`, the pinned Node
in `node/` with a `current` link when the machine had no Node 26.1 or later, and the launcher
`bin/binference` (`bin\binference.cmd` on Windows), whose second line says the installer wrote it.
The owner may have added `bin/` to PATH by the line the script printed.

After such an install, `npm uninstall` empties the package from `npm/` and leaves the launcher,
which then fails on every run, and the pinned Node with its own npm. The owner was not told which PATH
line to remove. A Node that was already on the machine sits outside the data folder.

## Decision

- `binference uninstall` reads the install as the script's when the prefix is the `npm/` folder of
  a folder named `binference` and the launcher beside it carries the installer's line. Any other
  npm install keeps decision 0264's `npm uninstall`.
- For the script's install it removes `npm/`, `node/` when the script put a Node there, and the
  launcher, then `bin/` and the data folder once no file is left in them. A file the owner put in
  the data folder stays, with its folder. It never runs npm for it and never touches a Node or npm
  outside the data folder.
- On Windows, which holds a running program's files, it removes nothing and prints one PowerShell
  command that removes the same parts and the folders left empty, for the owner to run once
  `uninstall` has ended.
- It then says, in the owner's language, what went, and which PATH entry to remove: the exact
  `export PATH="<data>/bin:$PATH"` line on macOS and Linux, the `bin` folder in the user PATH on
  Windows. It never edits a startup file or the user PATH, as the script never writes them.
- When a part cannot be removed, it exits 1 and prints the `rm -rf` command that removes the parts.

## Consequences

- After the one-liner, one `binference uninstall --state` leaves nothing of binference on macOS
  and Linux but the PATH line the owner added.
- A Windows owner runs one more command, as with decision 0264.
- An owner who reinstalls downloads the pinned Node again.

## Alternatives

- **`npm uninstall` alone.** It leaves a launcher that fails and a Node the owner never asked for.
- **Remove the whole data folder.** It would take any file the owner kept there.
- **Remove the PATH line from the startup file.** It edits a file that is not binference's, which
  decision 0357 rules out for the install too.
- **Keep the pinned Node for a reinstall.** A whole Node release stays on a machine whose owner
  asked to remove binference.
