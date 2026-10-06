# @binference/platform

The OS layer: the state folder, owner-only files, the engine lock, IPC endpoints and the shutdown
sequence.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is the only package that names an OS. Code for one OS lives in `src/posix/` (macOS and Linux)
  or `src/win32/`; `createPlatform` picks the adapters once, from `process.platform`. Everything
  else in `src/` runs on every OS.
- It reads no environment variable: the composition root passes `BINFERENCE_HOME` in.
- Its public API is what `src/index.ts` exports. Contract suites live behind `src/testing.ts`
  (`@binference/platform/testing`). Every export carries TSDoc.
- Every interface in `ports.ts` has a contract suite in `src/contracts/`, and each adapter's test
  runs it. A Windows adapter's test runs only on Windows (`describe.runIf`); a POSIX one skips
  Windows (`describe.skipIf`). CI runs all three OSes, so each path is proven where it runs.
- Child processes go through `runCommand` (execa, an argument array, no shell, a time limit).
- The IPC address is not a security boundary: every connection authenticates through
  `openIpcChannel`. Node cannot set a named pipe's access list.
- Tests use real files, sockets, pipes and signals in a fresh temporary folder, with no sleeps
  and no polling: they wait on events, and time comes from a manual clock.
- Tests that touch the machine's keychain run only when `BINFERENCE_KEYCHAIN_TESTS=1`, which only
  CI sets. Unit tests replace `@napi-rs/keyring` with `vi.mock`.
