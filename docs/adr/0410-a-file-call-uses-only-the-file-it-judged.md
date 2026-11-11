# 0410. A file call uses only the file it judged

Status: Accepted

Accepted by the tech lead on 2026-11-11. Amends [decisions 0386](../DECISIONS.md#d0386) and
[0408](../DECISIONS.md#d0408).

## Context

The agent's file tools ([decision 0386](../DECISIONS.md#d0386)) find a path's real path, judge it
against binference's own folder, and then open the path again to read, write or remove it. The
workspace is writable by the agent's own commands, so a link on the way can move between the two
steps: the file used may not be the file judged. A link put in place after the check would let a
read return a file of binference's own folder, a write land there, or a removal delete one there.

The skill reads of [decision 0408](../DECISIONS.md#d0408) do the same: the folder hash, `skill/read`,
the shelf's `SKILL.md`, the `read` action of `skill_proposal` and the copy an apply makes list a
skill's folder, which never lists a link, and then open each file by its path again. A file or a
folder replaced by a link after the listing is read through it.

The browser ([decision 0401](../DECISIONS.md#d0401)) judges a `file:` address the same way, and then
the browser program opens the path itself.

A real path does not show a hard link: a hard link in the workspace to a file of binference's own
folder has a real path inside the workspace.

## Decision

- **Reads.** The platform's `readJudgedFile` opens the path, reads the handle's device and file
  number, then finds the path's real path and the device and file number there, and reads through
  the handle only when both name the same file and the caller's judge accepts the real path. The
  judge runs before the file's kind or size is told. A path that names another file by then is
  `changed`. The file tools judge each path as before, and again through the handle that reads it.
- **Writes.** `writeOwnerFile` takes the real path the caller judged. Once the new file exists
  beside it under a random name, made with an exclusive create, the real path of the folder that
  holds it must be the folder judged; otherwise the new file is removed by its real path and the
  write is `changed`. Only then is it renamed, or linked for a create, by its random name in that
  folder, which a folder that moves after the check cannot take.
- **Removals.** `removeOwnerFile` renames the entry to a random name in its folder and removes it
  only when the folder that holds that name is the one judged; otherwise it renames it back, by the
  real path of the folder it went to, and the removal is `changed`.
- **The refusal.** `file.changed`, an addition to protocol version 1, with words in English and
  Chinese: the path led to another file or folder while it was checked, nothing was read, written or
  removed, and the agent reads the path again. A real path in binference's own folder is `walled`
  as before.
- **Skill reads.** Every read of a skill's files goes through `readJudgedFile` and accepts only a
  real path inside the skill folder's real path, reached from its place's root (the state folder's
  workspace, its installed skills, the bundled skills) with no link on the way. A skill folder or a
  skill file that became a link reads nothing, and `skill/read` answers `skill.changed`.
- **Applied skills.** An apply puts the skill in place by the rule of a write: the agent's skills
  folder must have the real path judged before and after it is made, then the old skill's folder
  moves aside and the new one in, each first under a name only that step uses, the skills folder's
  real path checked after the step and the step undone otherwise. Such an apply is
  `skill.proposal_stale`: the new skill lands nowhere and nothing else moves aside.
- **Hard links.** The command wall keeps an agent command from making one to a walled file. On
  macOS, Seatbelt refuses `ln` of a walled file, as the link's source is a denied path, which was
  checked on this version; on Linux, bubblewrap covers the state folder with an empty file system,
  so a command sees no walled file to link; on Windows the agent's shell is off. The command wall
  contract now makes the link and checks that it is refused, so CI checks Linux too. The file
  tools therefore do not refuse a file with more than one link, which is common outside
  binference's folder, as in a project's package store.
- **Browser.** The browser program no longer opens a `file:` path. Each `file:` request, the page
  and every part of it, is answered from the bytes `readJudgedFile` read with the walls as its
  judge, at most 20 MiB, typed by the name's extension, through the browser's route; any other
  outcome refuses the request. Chosen over copying each file after the check: the route already
  sees every `file:` request, so no second copy lands on disk.

## Consequences

- A link that moves during a file call cannot lead a read, a write or a removal into binference's
  own folder; the agent reads the path again and goes on.
- A removal that loses such a race renames what it found back at once; in a second race in the
  same moment it stays under its random name in the folder it went to. Folders a write made on a
  path that moved may stay, empty.
- `writeOwnerFile` and `removeOwnerFile` take real paths only: a path through a link is `changed`.
- A `file:` page is held in the engine's memory before the browser gets it, and one over 20 MiB
  does not load. A `file:` address of a folder shows no listing.
- In such a race, the file the removal found, which may be one of binference's own, carries the
  random name for the moment between two calls before it goes back. An apply's moves do the same
  with a folder.
- An apply whose skills folder moves again before the old skill can go back leaves the old skill in
  `skill-review/work/`, which the apply then removes; the agent's own commands could remove that
  skill anyway.
- The Linux check of the command wall runs on CI; Windows has no agent shell to check.

## Alternatives

- **Open each part of the path without following links.** Node has no call that opens a file
  relative to an open folder, so it would need a native module on every OS.
- **Refuse a file with more than one link.** No agent command can make one into binference's
  folder, and the refusal would stop reads of linked files the owner uses every day.
- **Copy a `file:` page into a private folder after the check.** It writes a second copy of every
  page, and the browser's route already sees every `file:` request, so it can answer each one with
  the bytes read.
- **Check after the use.** Bytes already handed to the agent cannot be taken back.
