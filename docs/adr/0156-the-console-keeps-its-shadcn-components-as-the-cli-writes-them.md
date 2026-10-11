# 0156. The console keeps its shadcn components as the CLI writes them

Status: Proposed

## Context

The console's stack is shadcn on Base UI ([ENGINEERING.md section 24.5](../ENGINEERING.md#section-24-5)),
and a component is added with the shadcn CLI. The CLI writes each component as source into
`src/components/ui/`. That source follows shadcn's style, not this repository's: no semicolons,
no declared return types, no TSDoc, and `cn` from shadcn's own `cn` package. Under the base flags,
`isolatedDeclarations` fails every component (TS9010, TS9013), and Oxlint and oxfmt would rewrite
or refuse it. The console is a Vite app: it publishes no declarations and no package API.

## Decision

- `packages/console/src/components/ui/` holds the components exactly as `shadcn add` writes them.
  Oxlint, oxfmt, knip, jscpd and the coverage report skip that folder. A component changes only
  through the CLI, and the console's look lives in its theme (`src/app/theme.css`).
- The console's `tsconfig.json` turns `isolatedDeclarations` off, as `scripts/tsconfig.json` does;
  `check:tsconfig` allows it there. Every other base flag holds, and the components pass them.
- The console uses shadcn's `cn` package, which the CLI imports, in place of `clsx` with
  `tailwind-merge`.

## Consequences

- Updating a component is `shadcn add <name> --diff`, with no hand merge of our edits.
- The rest of the console meets every rule: declared return types, TSDoc, sparse comments.
- A bug in a shadcn component is fixed upstream or by a wrapper in `src/screens/`, never in place.

## Alternatives

- **Edit each component to the repository's rules.** Every update would be a hand merge, and the
  edits would hide what the CLI changed.
- **Keep `isolatedDeclarations` and annotate the components.** The same hand edits, for
  declarations nobody reads.
