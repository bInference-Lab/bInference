# @binference/core

Results, errors, branded ids, amount math, retry, and the Clock, Random, Logger, Http and SecretStore
ports.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is pure: no I/O, no clock, no randomness, no `process`. Time and randomness come through the
  `Clock` and `Random` ports.
- Its public API is what `src/index.ts` exports. Test fakes and contract suites live behind
  `src/testing.ts` (`@binference/core/testing`), which only tests import. Every export carries
  TSDoc.
- Faults throw `BinferenceError` with a dotted code; expected outcomes return `Result` with a
  string-literal error. `binference-error.ts` holds the only class in the repo.
- `src/amount/` is money code: `bigint` base units, a rounding direction on every division,
  property tests beside each module, and the 95% coverage bar.
- Every interface in `ports.ts` has a contract suite in `src/contracts/`, and every module that
  implements a port runs that suite in its own test. `pnpm check:contract-suites` enforces both.
- Tests run on fake timers: drive time with `createManualClock` from `@binference/core/testing`.

## Schemas under `isolatedDeclarations`

`isolatedDeclarations` refuses an export whose type the compiler must infer, and `z.infer` over an
unannotated schema is such an export (TS9010, TS9013). Every package writes schemas this way:

1. Declare the type first: an `interface` for an object shape, a `Brand` for an id, an account or
   an amount.
2. Annotate the exported schema with that type and its wire type:
   `export const bpsSchema: z.ZodType<Bps, number> = z.number().refine(isBps);`
3. A brand comes from a type guard such as `isBps(value): value is Bps`, passed to `.refine()`.
   zod narrows the output through the guard, so no `as` is needed.
4. A codec that changes the type is annotated with its zod classes:
   `export const decimalStringSchema: z.ZodCodec<z.ZodString, z.ZodBigInt> = z.codec(...)`.
5. No `z.infer` in an exported position. The compiler checks the schema's output against the
   declared type, and a test parses a fixture of every shape, so the two never drift.

This keeps one schema per shape (SCH-3) and one declared type per shape; the type is written once,
beside its schema, instead of inferred.
