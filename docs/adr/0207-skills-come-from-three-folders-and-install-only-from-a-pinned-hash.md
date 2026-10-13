# 0207. Skills come from three folders, and install only from a pinned hash

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[ARCHITECTURE.md section 5](../ARCHITECTURE.md#section-5) gives agents `SKILL.md` playbooks in the
Agent Skills format: the prompt holds an index (name, description, location), the model reads a
skill when a task matches, third-party skills install from git or npm with a pinned hash, and a
lint refuses a skill that asks for keys or seed phrases. [Spec 8](../specs/runtime.md#section-7-1)
puts the index after the workspace files in the stable prefix, and spec 1 has `skill/list`,
`skill/add` and `skill/remove`. They leave open:

- **Where skills live**, which wins when two share a name, and how the runtime, which opens no file
  ([decision 0200](../DECISIONS.md#d0200)), reads one. `WorkspaceFiles` holds only an agent's root
  files.
- **Our own fields.** The Agent Skills format makes `metadata` a map from string keys to string
  values, so a nested `metadata.binference` object is not a valid skill.
- **What `skill/add` takes**, which hash pins each source, and what the lint covers.
- **Whether a skill's text is outside content** (spec 8, section 5.4).

## Decision

- **Three places**, each skill a folder with its `SKILL.md`:
  - `bundled`: the package's `skills/`, shipped with each release;
  - `installed`: `skills/<name>/` in the state folder, for every agent, recorded in
    `skills/installed.json` with its source, hash and time;
  - `workspace`: `workspace/<agent>/skills/<name>/`, the owner's own, for one agent.

  The owner's workspace skill wins over a bundled one of the same name; an install may not take a
  bundled name (`skill.name_taken`). A skill's id is its name when installed, else
  `bundled:<name>` or `workspace:<name>`; `skill/remove` removes installed skills only.

- **The engine reads skills; the runtime asks.** `skill/list { agent }` answers each skill the
  agent's index holds with its `description`, `location` (`<place>/<name>/SKILL.md`) and `place`;
  the runtime reads it at each turn, like the workspace files. A new operation, `skill/read`
  (`read`), `{ agent, skill, file? }`, answers the text of one file of a skill that list holds:
  `SKILL.md` unless `file` names another, as a relative path of letters, digits, `._-` and `/`.
  A path with an empty, `.` or `..` part, a leading `.`, a link, or a file the folder does not hold
  is refused; so is a file over 256 KiB or one that is not UTF-8 text.
- **The frontmatter** is YAML read with `yaml` and checked with zod as the format says: `name` of
  1 to 64 lowercase letters, digits and single hyphens, equal to its folder's name; `description`
  of 1 to 1,024 characters; optional `license`, `compatibility` (at most 500), `allowed-tools`, and
  `metadata` of strings. Other keys are kept out of everything binference reads. binference's own
  keys are `metadata` keys that start with `binference-`: `binference-audience` is `agent`, `mcp`
  or `all` (the default), and a skill for `mcp` clients alone, such as `binference-tools`, stays
  out of the agents' index.
- **The index** lists the skills by name, at most 100, then a line with the number left out. A
  skill whose frontmatter fails, or whose text the lint finds anything in, is left out of the list
  and logged by its place and name; it never reaches the prompt.
- **`skill/add { source, hash }`** runs as a job, one at a time:
  - `git:<url>` with an `https://`, `ssh://` or `file://` URL, and `#<folder>` for a skill below the
    repository's top; `hash` is the full commit id (40 or 64 hex digits). The engine clones with
    `git` and no hooks, checks out that commit, and refuses when `HEAD` is not the hash.
  - `npm:<name>@<version>` with an exact version and `#<folder>` as for git; `hash` is the
    published integrity (`sha512-…`). The engine fetches the tarball with `npm pack`, the npm
    client every install already has, computes the tarball's own SHA-512, and refuses a mismatch.
    The tarball is read in memory: only plain files and folders, no link, no path outside it.
  - The skill is at most 2 MiB in 200 files. Every text file, `SKILL.md` first, passes `lintSkill`,
    which refuses a request for a key, seed phrase, passphrase, password or token, a download piped
    into a shell, a secret store sent over the network, and a secret written out. Then the folder
    replaces an installed skill of that name in one move.
  - It fails `skill.hash_mismatch`, `skill.refused` (with each finding's file, line and code, never
    the text), `skill.invalid`, `skill.name_taken` or `skill.fetch_failed`, and nothing changes.
- **An installed skill's text is outside content.** A third party wrote it: `open_skill` on an
  installed skill marks the turn, so a proposal that follows carries the warning. Bundled skills and
  the owner's workspace skills are trusted, as the workspace files are.

## Consequences

- Spec 1 gains `skill/read`, the `description`, `location` and `place` of a skill in `skill/list`,
  and the `skill` error codes; ARCHITECTURE.md section 5 names the `binference-` keys.
- A turn reads one more answer before its first model call; the prefix stays byte-identical while
  no skill changes, since the index is sorted by name.
- A skill can no longer reach the agent with a sentence the lint finds, wherever it sits; a
  workspace skill the lint refuses shows in the engine's log, not in chat.
- Installing from npm needs `npm` on the `PATH`, and from git needs `git`.

## Alternatives

- **The runtime reads the skill folders itself.** It would need file permissions it does not have,
  and a hosted engine could not keep skills elsewhere. Rejected, as in decision 0200.
- **A nested `metadata.binference` map.** Other Agent Skills readers would refuse the skill.
  Rejected.
- **An install may replace a bundled skill.** A third party's text would then answer to the name
  of a skill binference ships. Rejected; the owner's own workspace skill may.
- **A tag or a version range as the pin.** A tag moves and a range resolves later; neither pins
  the text that passed the lint. Rejected.
- **Trust installed skills as the owner's words.** The owner chose the skill, but not its text, and
  the mark costs one warning line on a card. Rejected.
