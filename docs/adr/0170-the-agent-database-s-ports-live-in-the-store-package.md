# 0170. The agent database's ports live in the store package

Status: Accepted

Accepted by the owner on 2026-10-11.

## Context

The engine's store ports live in `@binference/engine`, with their contract suites and in-memory
fakes, and `@binference/store` implements them on SQLite. A store task must be listed in its
database's definition inside `@binference/store`, which the store's worker threads load, so an
adapter's tasks, and the record types and schemas they parse, are in that package too.

`agent.sqlite` belongs to the agent runtime ([spec 8](../specs/runtime.md)). The package graph lets
`@binference/runtime` import `@binference/store`, and `@binference/store` import the engine, never
the runtime. The engine never reads `agent.sqlite`, so its ports have no place in the money core.

## Decision

- The ports of `agent.sqlite` (the writer fence, sessions and turns, the transcript, and the ones
  later work adds) are declared in `@binference/store`, in `src/ports.ts`, with their records and
  zod schemas beside their tasks.
- Their contract suites and in-memory fakes are in the same package, exported from
  `@binference/store/testing`, and every adapter and fake runs its port's suite.
- The runtime depends on these ports, and its composition root binds them to `agent.sqlite`'s
  handle; the engine never imports them.

## Consequences

- The package graph stays as it is: no cycle, no new edge.
- `@binference/store` holds ports of its own beside the engine's adapters; its rules say which
  are which.
- A Postgres adapter for the Cloud implements these ports from the store package's types and
  passes the same suites.

## Alternatives

- **Declare them in `@binference/engine`.** It puts the runtime's storage in the money core, which
  never uses it, and grows an entry point already at its size limit. Rejected.
- **Declare them in `@binference/runtime`.** The store's tasks would need the runtime's types,
  which the graph forbids, so every record would be declared twice. Rejected.
- **A new package for the agent database.** One more package for five ports that share the
  store's workers, dialect and migrations. Rejected.
