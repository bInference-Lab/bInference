# 0389. The agent's tools answer every edge case with a next step

Status: Accepted

Accepted by the lead on 2026-11-07. Amends [decisions 0384](../DECISIONS.md#d0384),
[0385](../DECISIONS.md#d0385), [0386](../DECISIONS.md#d0386), [0387](../DECISIONS.md#d0387) and
[0388](../DECISIONS.md#d0388).

## Context

The tools of decisions 0384 to 0388 work for the plain case, but several edge cases end in a dead
end or a quiet surprise for the model or the owner:

- A file edit that cannot be placed answers only "not found" or "more than once", so the model
  guesses again. A patch whose hunk stands twice is placed at the first match, and one whose lines
  differ only in spaces is refused. A write or edit that changes nothing still writes.
- A line longer than a page cannot be read past its first 10 KiB. A file named in a screenshot's
  name, with its narrow no-break space, is not found when the model types a plain space.
- `look_at_image` reads one image, so comparing two charts takes two looks and two descriptions.
  It cannot read an image the model holds as a `data:` address, and a file outside the workspace
  passes while `files.workspaceOnly` is on.
- A chart with two categories of one label draws one bar over the other.
- A credential request the owner lets lapse stays on the console's screen until the owner submits
  it, and `binference credential set` with the requested name leaves the request open.
- `notes_get` returns a long note whole, and `notes_forget` needs an id the model may not hold.

## Decision

- **File edits (amends 0386).** An edit that cannot be placed changes nothing and answers why in
  `file/edit`'s new `problem` field: which edit (`edits[i]`), whether its text stands nowhere or
  how many times, or which edit it overlaps, with up to three of the file's closest lines and how
  alike each is. The loose match also reads Unicode's compatible characters as plain ones. Each
  line keeps its own line break. `file_edit` takes one edit as `oldText` and `newText` beside
  `edits`.
- **Patches (amends 0386).** A hunk is found exactly, then ignoring trailing spaces, then all outer
  spaces, then reading special characters as plain ones; the first way that finds it decides, and
  lines found more than once there are refused, as is a `@@` line that stands more than once. Added
  lines with none to replace go right after their `@@` line. The lines a hunk keeps stay as the file
  wrote them. A refusal quotes the lines it could not place. A patch wrapped in a shell heredoc
  reads as the patch inside it. `file/patch` honors `files.workspaceOnly` as well as
  `files.patchWorkspaceOnly`.
- **Reads and writes (amends 0386).** `file/read` takes a `cursor`, a place inside a line, and its
  `next` gives one when a single line passes a page. An offset past the end answers the file's
  length. A file with a UTF-16 byte order mark reads as text. A path not found is tried again in
  its other common spellings (NFC and NFD, a narrow or no-break space as a plain one, curly quotes
  as straight). A write or edit that changes nothing writes nothing and says so; one that does is
  read back and compared, and a mismatch is `file.unwritable`. A patch that leaves every file as it
  was says so.
- **Images (amends 0385).** `look_at_image` reads 1 to 4 images, each named by an address, a file
  path, or a `data:` address holding a PNG, JPEG or WebP image of at most 5 MiB, which the runtime
  decodes and checks itself; a `file://` address or a path with a leading `@` names a file. The
  model sees them together, in the order named. A file goes through the file tools' reads: a
  relative path is read in the workspace, and `files.workspaceOnly` refuses one outside it,
  `image.outside_workspace`.
- **Charts (amends 0387).** Every category of a bar, area or line chart has its own label.
- **Credentials (amends 0388).** A request closes at its time with `expired` pushed, read or not.
  `credential/set` answers as stored every open request of its name, which starts that agent's
  next turn. The agent's tool holds the time it names to 30 to 3600 seconds instead of failing, its
  answer says how long the owner has, and its list shows when each credential was stored.
- **Notes (amends 0384).** `notes_get` reads up to 500 lines from a line the model names and says
  where the next page starts. `notes_forget` also takes words: it forgets by words only when exactly
  one note found holds them as written, and otherwise forgets nothing and lists the notes found.
- `file/edit`'s `problem`, `file/read`'s `cursor` and `image.outside_workspace` are additions to
  protocol version 1. `file.no_match`, `file.many_matches` and `file.overlap` stay in the code list,
  though the engine now answers those cases in `problem`.

## Consequences

- Every refusal of these tools names what to do next, so the model rarely needs a second guess.
- An edit's `problem` may quote the file's lines, so the tool marks that answer as outside content.
- An owner who lets a credential request lapse sees the prompt close on time; no turn starts, and
  the agent's tool answer told it to check its list before it asks again.

## Alternatives

- **Wake the agent when a credential request lapses.** It would spend a turn to say nothing
  arrived, and the inbox has no kind for an engine event that is not the owner's message.
- **Forget a note by the best search hit.** A loose search can rank the wrong note first; a note
  that holds the words as written is what the model meant.
- **Shrink images that pass 5 MiB, and read GIFs.** Both need an image library in the runtime; the
  owner can send a smaller image instead.
