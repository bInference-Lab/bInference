# @binference/platform

The OS layer: the state folder, owner-only files and the engine lock.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is the only package that names an OS. Code for one OS lives in `src/posix/` (macOS and Linux)
  or `src/win32/`. Everything else in `src/` runs on every OS.
- It reads no environment variable: the composition root passes `BINFERENCE_HOME` in.
- Its public API is what `src/index.ts` exports. Contract suites live behind `src/testing.ts`
  (`@binference/platform/testing`). Every export carries TSDoc.
- Every interface in `ports.ts` has a contract suite in `src/contracts/`, and each adapter's test
  runs it. A Windows adapter's test runs only on Windows (`describe.runIf`); a POSIX one skips
  Windows (`describe.skipIf`). CI runs all three OSes, so each path is proven where it runs.
- Child processes go through `runCommand` (execa, an argument array, no shell, a time limit).
- Tests use real files in a fresh temporary folder, with no sleeps and no polling.
