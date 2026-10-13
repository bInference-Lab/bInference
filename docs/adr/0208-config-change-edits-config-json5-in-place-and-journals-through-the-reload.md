# 0208. config/change edits config.json5 in place and journals through the reload

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Spec 1](../specs/protocol.md#section-7-9) section 7.9 gives `config/change` (`admin`):
`{ patch, reason? }` → `{ config, restartNeeded }`, journaled and announced.
[Spec 2](../specs/config.md#section-2) says the engine never rewrites keys the owner did not change
and keeps comments, and [decision 0118](../DECISIONS.md#d0118) says `config/change` writes the
file through the same path the reload watches. [Decision 0134](../DECISIONS.md#d0134) already
edits one value, `owner.locale`, in place for the owner's chat. The specs leave open:

- **What a patch means**: how a key is removed, and whether an object merges or replaces.
- **Where a new key goes**, and what a removed key takes with it.
- **What is checked before the write**, and against which layers.
- **Who the journal names.** The reload journals every change as `engine` on the surface
  `config.json5`, and the watch would see the change after `config/change` journaled it.

## Decision

- **The patch is a JSON merge patch** (RFC 7396) over the file: a key set to `null` is removed; an
  object merges into a group or a map of the config key by key; anything else replaces the value
  there whole. A secret source, an array, and a value the schema types as an object or as JSON
  are one value each, so a source replaces the source before it rather than merging into it.
- **The file is edited as text.** A set replaces the bytes of one value, or adds a missing key
  first in its object, indented as the object's first key, on one line. A removal takes the key's
  whole lines, with a comment at the end of its last line, when it has lines of its own; a comment
  above it stays. Every other byte, comment, quote style and key order is kept. The edited text
  must read as the file with exactly the patch applied, else nothing is written
  (`config.invalid`).
- **The whole config is checked first**, in the layers the engine runs with: defaults, the new
  text, the `BINFERENCE_*` variables and the start's `--set` flags. A secret written as text is
  `config.secret_inline`; any other problem is `config.invalid`; either way nothing is written.
- **One atomic write**: the text goes to an owner-only file beside `config.json5`, which then
  takes its place.
- **Journaled once, through the reload.** After the write, `config/change` hands the change to the
  reload path, which reloads at once, after any reload under way, and journals each changed key
  with the caller's credential and surface as its author and the patch's `reason`, then announces
  it with `notice.configChanged`. The watch that fires after it finds nothing changed.
- **`restartNeeded`** is true when any changed key is not one the engine reads on each use.
- **The answer** is the config as it now stands, every secret source shown as its kind.
- The owner's chat keeps its one patch, `{ owner: { locale } }` (decision 0134), on the same
  editor.

## Consequences

- `binference config set` and the console write the file a person edits, comments and all; a hand
  edit and a `config/change` meet in the same reload and journal.
- A key set or removed by a variable or a flag of the running start still wins over the file: the
  answer shows the config as it runs.
- A new key's place is its object's top, so a long object reads its newest key first.
- Spec 2 section 2 says how `config/change` edits the file; spec 1's row names the merge patch.

## Alternatives

- **Rewrite the file from the parsed config.** Every comment the owner wrote would go. Rejected.
- **Warn, then write the file without its comments.** The owner reads the comments the init wrote
  to learn each key. Rejected for the editor.
- **A list of path and value pairs in place of a merge patch.** The protocol already takes an
  object; a merge patch says set, merge and remove in that one object. Rejected.
- **Journal in `config/change` and let the reload journal again.** One change would show twice,
  once as the engine's. Rejected.
