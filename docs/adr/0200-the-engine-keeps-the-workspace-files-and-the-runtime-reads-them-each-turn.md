# 0200. The engine keeps the workspace files, and the runtime reads them each turn

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

Each agent has six workspace files ([ARCHITECTURE.md section 5](../ARCHITECTURE.md#section-5)):
`RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md` and `FIRST-CHAT.md`. Spec 1 serves
them with `agent/readFile` (`read`) and `agent/writeFile` (`admin`); spec 8 section 7.1 puts them
in every model call's stable prefix, and says an edit applies at the next turn. Spec 8 section 1
says the runtime owns them, yet the runtime reads no file of the engine and its package may not
open files, and the owner edits them from the CLI and the console, which reach only the engine.
The specs leave open who writes the files, where their text at creation comes from, how the
runtime reads them, and what a missing file answers.

## Decision

- **One writer: the engine,** through core's `WorkspaceFiles` port. The self-hosted adapter in
  `@binference/platform` keeps them in `workspace/<agent id>/`, each folder owner-only. A write
  replaces a file whole through an owner-only draft; a create links its draft into place and never
  replaces a file. Names are checked before any file is touched: an agent id, and capitals, digits
  and dashes ending in `.md`.
- **Made at the agent's creation,** from templates in the owner's language (the `workspace` area of
  the messages): the six files, `FIRST-CHAT.md` with spec 4 section 8.3's eight questions. A file
  already there is kept, so a run of `binference init` that stopped and runs again changes nothing
  the owner wrote.
- **The runtime reads them with `agent/readFile`** at the start of each turn, in spec 8's order,
  as any client reads them. So an edit applies at the next turn, the runtime needs no file
  permission, and a hosted engine can keep them anywhere.
- **A missing file is `agent.file_missing`.** The prompt leaves it out: an agent made before the
  files existed, or one whose first chat removed `FIRST-CHAT.md`.
- **Owner text is trusted.** The files are the owner's own words, and the prefix holds nothing from
  outside content; the agent changes them only through tools that a later change adds.

## Consequences

- Spec 1 gains `agent.file_missing`; spec 8 section 1 says the runtime reads the files from the
  engine.
- A turn makes six reads over the local connection before its first model call; each answer is at
  most 1 MiB, and the prompt cuts each file to spec 8 section 7.2's sizes.
- The first chat's writes (`STRATEGY.md`, `PERSONA.md`, removing `FIRST-CHAT.md`) need an operation
  of the `agent` scope, which the first chat adds.

## Alternatives

- **The runtime reads the folder itself.** It would need file permissions and its own adapter, two
  writers would race, and a hosted engine could not move the files.
- **Templates in the code.** The owner reads these files, so their words belong with every other
  word in English and Chinese, checked against the glossary.
- **An empty file in place of a missing one.** `FIRST-CHAT.md` must be able to end, and an empty
  answer cannot tell "removed" from "empty".
