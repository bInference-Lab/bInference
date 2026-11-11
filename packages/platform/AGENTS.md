# @binference/platform

The OS layer: the state folder, owner-only files, the engine lock, IPC endpoints, log files and the
shutdown sequence.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is the only package that names an OS. Code for one OS lives in `src/posix/` (macOS and Linux)
  or `src/win32/`; `createPlatform` picks the adapters once, from `process.platform`. Everything
  else in `src/` runs on every OS.
- It reads no environment variable: the composition root passes `BINFERENCE_HOME` in.
- Its public API is what `src/index.ts` exports. Contract suites live behind `src/testing.ts`
  (`@binference/platform/testing`). Every export carries TSDoc.
- Every interface in `ports.ts` has a contract suite in `src/contracts/`, and each adapter's test
  runs it. A Windows adapter's test runs only on Windows (`describe.runIf`); a POSIX one skips
  Windows (`describe.skipIf`). CI runs all three OSes on each push to `master`, after the merge, so
  a change to one OS's path runs its tests on that OS before the merge.
- `watchFile` hears a file through the OS's file events; when they fail, as when a machine runs
  out of file watches, it reads the file again, tries the events again after 0.5, 2 and 5 seconds,
  then checks the file every 100 milliseconds (decision 0396).
- Child processes go through `runCommand` (execa, an argument array, no shell, a time limit).
- The agent's shell runs behind the OS's command wall, or, when `BINFERENCE_SHELL_LAUNCHER` names
  a socket, through the Docker image's shell launcher (decision 0412): `serveImageShell` runs in
  the image's program as `binference-shell`, and the engine's `createImageShellLauncher` checks
  every line it sends, since a command can replace it. Both pass the `ShellLauncher` contract in
  one process, with the server on a socket of the test's folder.
- `src/outbound/` holds the connection pools of the engine's and the agent runtime's outbound
  HTTP adapters (decision 0347), the one place here that imports undici, exported alone as
  `@binference/platform/outbound` so the runtime's bundle takes nothing else of this package. They
  refuse every request until a route is put in force.
- The IPC address is not a security boundary: every connection authenticates through
  `openIpcChannel`. Node cannot set a named pipe's access list.
- Tests use real files, sockets, pipes and signals in a fresh temporary folder, with no sleeps
  and no polling: they wait on events, and time comes from a manual clock.
- Tests that touch the machine's keychain or login items run only when
  `BINFERENCE_KEYCHAIN_TESTS=1` or `BINFERENCE_SERVICE_TESTS=1`, which only CI sets. Never set them
  on your own machine. Unit tests replace `@napi-rs/keyring` with `vi.mock` and answer for
  `launchctl`, `systemctl` and `schtasks` with a fake runner.
