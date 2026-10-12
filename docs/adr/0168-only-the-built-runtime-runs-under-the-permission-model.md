# 0168. Only the built runtime runs under the permission model

Status: Amended by 0174

Accepted by the owner on 2026-10-11.

## Context

[Spec 8, section 2.1](../specs/runtime.md#section-2-1) has the engine start the agent runtime as a
child process under Node's permission model, with an empty environment and pipes only the engine
holds. Node's permission model lets a process read the file it was started with and nothing else
it was not granted, so the runtime ships as one bundled file, `dist/runtime-process.mjs`, as the
signer does.

A checkout that runs binference from its TypeScript source has no such file. Its engine runs
under a TypeScript loader that reads every source file it imports, from many folders, and Node's
loader hooks may run off the main thread. Under the permission model the loader is refused those
reads, so the runtime cannot start from source with the grants spec 8 gives it.

The engine's own tests, and an owner's engine run with `binference start` from a checkout, need
a runtime that starts.

## Decision

- **The built runtime runs under the permission model.** The engine starts
  `@binference/runtime/process` by its real path with `--permission`, `--allow-net` (the engine's
  IPC socket and the model providers) and `--disallow-code-generation-from-strings`, and no other
  grant. It may read only its own file, write none, and start no child process or worker. A later
  change that opens `agent.sqlite` or the workspace grants exactly those paths in
  `runtimeNodeArguments` and nowhere else.
- **A runtime started from source runs without it.** When `@binference/runtime/process` resolves to
  its TypeScript entry, which only the workspace's source condition does, the engine starts it with
  its own loader options and no permission flag. Everything else stays: the empty environment, the
  pipes, the token made for that start.
- **Every runtime sees an empty environment.** The engine passes none of its variables; only what
  the OS adds to every process remains (`SystemRoot` on Windows, the text encoding on macOS).

## Consequences

- An installed binference, which has only the built file, always sandboxes its runtime.
- The engine's tests start the runtime from source as a real process and prove its environment,
  restarts and stop; the sandbox itself needs a built runtime, as the signer's sandbox test builds
  its bundle.
- A developer who runs an engine from a checkout runs a runtime that may read and write files the
  built one may not. Nothing published runs that way.

## Alternatives

- **Grant the source runtime the whole checkout and worker threads.** It still gives the runtime
  far more than spec 8 allows, ties the grants to the loader's internals, and fails as soon as the
  loader changes how it reads files. Rejected.
- **Build the runtime before each run from source.** A build on every engine start makes `start`
  slow and needs the bundler at run time. Rejected.
- **Run no runtime from source.** The engine's end-to-end tests could then not prove the runtime's
  process behavior. Rejected.
