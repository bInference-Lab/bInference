# 0386. The agent reads and changes files on the owner's machine

Status: Amended by 0389

Accepted by the owner on 2026-11-07.

## Context

The agent's shell (decision 0378) can read and change any file outside binference's own folder,
but through commands: reading a long file, replacing a few lines or changing several files at once
took shell quoting the model often gets wrong, and nothing told it how much of a file it had read.

## Decision

- Four operations, additions to protocol version 1, in `agent` scope with no idempotency key, so
  no file's text is stored: `file/read` answers a page of a text file, at most 2,000 lines and
  10 KiB, with where the next page starts, or names an image file; `file/write` writes a file whole
  and makes its folders; `file/edit` makes exact replacements; `file/patch` runs a patch over
  several files.
- A path is absolute, under the owner's home folder with `~/`, or relative to the agent's
  workspace. Each is read at its real path, so a link never leads into binference's own folder,
  which is walled off as it is for the shell, its workspace aside. A write replaces a file through
  a new file beside it and keeps its permissions; a removal never follows a link and never removes
  a folder.
- An edit finds each old text exactly, else by a loose match that ignores trailing spaces and reads
  curly quotes, dashes and special spaces as plain ones; either way it must be unique and apart
  from the other edits, and the new text goes into the file's own span. Line breaks and a byte
  order mark stay as the file had them.
- A patch reads `*** Begin Patch` to `*** End Patch` with added, deleted, updated and moved files,
  its hunks placed after one another with the same loose matching. It writes nothing until every
  change is found; an added or moved file must find its place free unless the patch deleted it.
- `files.workspaceOnly` (false by default) keeps reads, writes and edits inside the workspace;
  `files.patchWorkspaceOnly` (true by default) keeps patches there. Config migration 17 to 18.
- The agent gets `file_read`, a read whose answers are outside content and which describes an
  image file through the image look (decision 0385), and the machine tools `file_write`,
  `file_edit` and `file_patch`. A page is 10 KiB so that it and its note fit in the 12,000
  characters of a tool result.

## Consequences

- The agent edits the owner's files exactly and safely, and pages through long ones.
- Files the agent reads may carry words meant to steer it; the answers mark the turn, so a proposal
  after one shows the outside-content warning and never fills in auto mode.
- A patch that fails part way through a write says the files before it were changed; planning
  first makes that rare.

## Alternatives

- **Leave file work to the shell.** It works, but quoting long texts in commands fails often, and
  the agent cannot tell how much of a file a command showed.
- **Allow writes in the workspace only.** Safer, but the owner asked the agent to work on their
  machine as the shell already can; the setting gives that choice.
