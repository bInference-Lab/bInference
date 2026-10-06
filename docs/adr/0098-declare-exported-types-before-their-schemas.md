# 0098. Declare exported types before their schemas

Status: Accepted

## Context

Rule SCH-2 in `docs/ENGINEERING.md` says types come from `z.infer`, so a type is never written
twice. The repository also compiles with `isolatedDeclarations` (rule TS-1), which needs every
export's type to be written out, so a declaration file can be made from one file at a time. An
exported schema whose type is inferred fails that flag under TypeScript 7.0.2 with zod 4.6.5:
`export type AccountRef = z.infer<typeof accountRefSchema>` and an unannotated
`export const accountRefSchema = ...` are both refused.

## Decision

Each exported shape has one type and one schema, written together:

- The type is declared first, as an interface or a branded type.
- The exported schema carries that type as its annotation, for example
  `export const bpsSchema: z.ZodType<Bps, number> = ...`.
- A brand comes from `.refine(typeGuard)`, which zod narrows, so no `as` is needed.
- A codec that changes the type is annotated with its zod classes.
- No `z.infer` appears in an exported position. Inside a file, `z.infer` stays allowed.

The compiler checks the schema's output against the declared type, and a test parses a fixture
of every exported shape, so the two cannot drift. SCH-2 changes to say this.

## Consequences

- `isolatedDeclarations` stays on, so declaration files build fast and per file.
- Each exported shape is written twice, once as a type and once as a schema, beside each other in
  one file. The compiler and the fixture tests catch any difference.
- `packages/core/AGENTS.md` holds the pattern with examples; every package follows it.

## Alternatives

- **Turn `isolatedDeclarations` off.** Inferred types work again, but declaration builds need
  the whole program, and a public export's type can change without anyone writing it. Rejected.
- **Hand-written types with no schema link.** Nothing stops the two from drifting. Rejected.
- **Generate types from schemas in a build step.** An extra generator and generated files for
  what the compiler already checks. Rejected.
