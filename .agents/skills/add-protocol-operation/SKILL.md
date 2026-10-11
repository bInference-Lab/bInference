---
name: add-protocol-operation
description: Adds an operation to the engine protocol, or a field or error code to one, from the spec row to the zod schemas, the compatibility snapshot and the engine's handler. Use when a client, the CLI, Telegram or an MCP tool needs the engine to answer something new.
---

# Add a protocol operation

The protocol is the only way into the engine. Every surface (CLI, console, Telegram, MCP) calls
the same operations, so one is designed once, in the spec, and every client reads it from
`@binference/protocol`.

## 1. The spec first

- Add the row to the operations table in `docs/specs/protocol.md`: the name, its one scope, and
  `args → result` in one line. Write what the engine answers, refuses and stores below the table.
- **The name** is `domain/action`, with the action in camelCase (`asset/search`,
  `portfolio/resetPaper`). Its words come from `docs/GLOSSARY.md`; add a new one there first.
- **The scope** is exactly one of `scopes` in `packages/protocol/src/auth/scopes.ts` (`read`,
  `propose`, `chat`, `agent`, `confirm`, `loosen`, `admin`). Pick the narrowest that lets the
  caller do the job. Something that moves funds is `confirm` or wider, and loosening a limit is
  `loosen`; neither is ever `read` or `propose`. A call that needs a wider scope in some cases names it in `scopeCase`.
- A choice the spec and the rules leave open is an ADR (`write-adr`) before the code.

## 2. The schemas

In `packages/protocol/src/operations/<domain>-operations.schema.ts`:

- Declare the args and result interfaces, then the row in the table: `name`, `scope`, the flags of
  its kind (`readFlags`, `writeFlags` for a write that takes an idempotency key, `localWriteFlags`
  for one over IPC alone, `subscribeFlags`), `args` and `result`.
- Args are `z.strictObject`; results are `z.object`, so an older client drops a field it does not
  know. Optional fields use `.exactOptional()`, never `null`.
- Money is never a number: `amountSchema`, `decimalStringSchema` or `signedUsdMicrosSchema`.
- A shared view goes into `src/views/<name>-view.schema.ts`, its interface declared and its schema
  annotated with it (decision 0098).
- Add the example call in `src/examples/<domain>-examples.ts`; the table type makes a missing one
  a compile error.
- Add the row to `specTable` in `src/operations/operations.test.ts` and raise its count.

## 3. Error codes

- A new code is dotted (`telegram.unreachable`) and goes into `protocolErrorCodes` in
  `src/errors/protocol-error-codes.ts`, with its test.
- Its message goes into `packages/i18n/messages/en/error.json` and `zh/error.json` in the same
  change.
- A code a later call may pass goes into `retryableCodes` in `packages/server/src/call-failure.ts`.

## 4. Compatibility

Inside a protocol version, changes are additive: new operations, optional fields, push kinds and
error codes. Then:

```sh
pnpm check:protocol-compat --write
```

and commit `packages/protocol/snapshots/v<version>.generated.json`. A removed field, a narrowed
type or a changed meaning raises `protocolVersion` instead, and the engine serves the previous
version for one stable release.

## 5. The engine's handler

- The handler lives in `packages/engine/src/operations/<area>-handlers.ts`, or in the feature's
  own folder, typed `EngineHandler<"<name>">`. It calls the use case and maps its outcomes to
  error codes; it holds no rule of its own.
- Add it to `EngineHandlers` in `src/operations/create-engine.ts` through the area's
  `create<Area>Handlers`.
- Test it beside it with the test engine (`src/operations/test-engine.ts`): every answer, every
  refusal with its code, and the caller without the scope.
- A Telegram fast command may call it only when its scope is `read` or `confirm`
  (`ownerChatOperations`).

## 6. Surfaces

- A CLI command reads its words from i18n (`command.*`) in both languages.
- A `read` or `propose` operation that an outside AI client should reach becomes an MCP tool
  (`add-mcp-tool`).

## 7. Check

```sh
pnpm vitest run packages/protocol packages/engine/src/operations --maxWorkers=2
pnpm check:protocol-compat
pnpm check:i18n
```

`protocol` and `engine` are money-path packages: run `review-money-path` and paste its checklist.

## 8. Report

The operation, its scope and kind, the spec section, the error codes added, the snapshot change
and the tests.
