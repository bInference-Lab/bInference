# 0408. The agent proposes skills and the owner applies them

Status: Accepted

Accepted by the tech lead on 2026-11-11.

## Context

A skill is a playbook the agent follows when a task matches it (decision 0207). The owner asked
for an agent that learns: one that writes down a procedure that worked, or fixes a skill whose
steps went wrong, so the next turn does better. A skill steers every later turn that opens it, so
a skill the agent writes on its own is a standing instruction to itself that nobody read. A web
page, a token's name or a plugin's answer could plant one, and it would outlive the turn that read
it.

Today the agent can already write a skill: workspace skills live in
`<state>/workspace/<agent>/skills/<name>/SKILL.md`, and the file tools and the shell reach the
workspace. Nothing checks that the owner wanted the skill that loads.

## Decision

- **Every new skill or change the agent makes is a skill proposal**, which waits for the owner's
  approval and is never applied by itself. The agent's tool `skill_proposal` takes one action:
  `create` (a new skill: its name, a description of at most 160 bytes, its whole body, and support
  files), `update` (the whole body again), `patch` (an exact text to replace that matches once in
  `SKILL.md`), `read` (a skill the agent's index holds, with its revision), `revise` (a pending
  proposal of its own), `list` (its proposals, 20 by default, at most 50, by status) and `inspect`
  (one proposal with its body, files and findings). It has no action that applies, rejects or
  removes a proposal. `create`, `update`, `patch` and `revise` also take `reason`, one line of at
  most 280 characters on why the agent proposes it, which every surface shows the owner as the
  proposal's purpose; a revision that leaves it out keeps the one before.
- **A turn that read outside content proposes nothing.** `create`, `update`, `patch` and `revise`
  are refused in a turn marked as outside content, in the tool and again in the engine, which
  takes the mark of the runtime's running turn as it does for intents (`skill.outside_content`).
  Helpers get no `skill_proposal`.
- **What a proposal holds.** The body is at most 40,000 bytes; binference writes the frontmatter
  (`name`, `description`) itself, and an update keeps the skill's other frontmatter fields. Up to
  10 support files of at most 40,000 bytes each, UTF-8 text, under `references/`, `examples/`,
  `templates/` or `assets/`. No `scripts/` in v1: binference runs no skill scripts, and a script the
  agent wrote would run through its shell with the owner's rights once applied, so the owner would
  have to review code line by line in a chat. An `update` or a `patch` names the revision `read`
  gave, the SHA-256 of the skill's folder, so the agent changes the text it read
  (`skill.changed` otherwise). Only the agent's workspace skills take an update; a bundled skill
  changes with binference and an installed one with its source (`skill.not_editable`). A new
  skill's name must be free in the index and among the pending proposals (`skill.name_taken`).
  An agent keeps at most 20 pending proposals (`skill.proposal_limit`) and its newest 100 ended
  ones.
- **Every proposal is scanned** when it is made and when it is revised: the skill lint on each
  text (decision 0207), which now also finds hidden characters (zero-width, bidirectional and tag
  characters that hide text from the owner's review), and a `destructive_delete` check for a
  removal of the root, the home folder or the state folder. A proposal with findings is kept and
  marked, every surface shows each finding by file, line and code, and **every finding blocks
  Apply** (`skill.proposal_blocked`): the skill shelf leaves out any skill with a lint finding, so
  an applied skill with one would never load, and a hidden character or a sweeping delete is not
  something the owner can weigh in a short review. The agent revises it instead. A revision
  replaces the proposal's text, files and description whole and is scanned as it is stored, and
  Apply scans the exact text and files it writes again rather than trust the findings stored
  beside them.
- **Where things live.** Proposals are files in `<state>/skill-review/proposals/`, outside the
  workspace, which the shell and the file tools cannot reach (decision 0378). The engine is their
  one writer; the runtime reads them only through `skillProposal/list` and `skillProposal/get`.
- **The owner applies.** `skillProposal/apply` and `skillProposal/reject` take the `confirm`
  scope, which the owner's surfaces hold and the agent runtime and MCP clients never do: the
  terminal (`binference skill proposals|show|apply|reject`), the console's Skills screen (Apply
  asks again), and `/skills` in the owner's private Telegram chat with an Apply and a Reject
  button. An applied proposal writes the skill into the agent's workspace skills folder, where the
  owner reads and edits skills, and accepts its new folder hash in the same step. An update whose
  skill changed since the proposal, or a new skill whose name a skill took meanwhile, is refused
  as stale (`skill.proposal_stale`) and marked `stale`. Each apply and accept is journaled under
  `skills.<agent>.<name>` with the hash before and after, who made it and on which surface, and
  told as a notice; a new or revised proposal is told too.
- **The agent hears the outcome at its next turn.** The skills section of each turn's prefix lists
  the agent's pending proposals and the five it decided last, applied, rejected with the owner's
  reason, or stale, read with `skillProposal/list` once per turn, beside `skill/list`. An engine message that wakes the
  agent would spend a model turn on every decision; the prefix costs one local read, and an
  applied skill is in the index from that turn on anyway.
- **A workspace skill loads only while its hash is one the owner accepted.** The hash is the
  SHA-256 of every file of the skill's folder by path and content, so a changed support file
  counts too. Accepted hashes are kept in `<state>/skill-review/accepted.json`. When the file is
  absent, which is the first run of this version, every workspace skill present is accepted and
  the file written. A workspace skill added or changed later, by the shell or by hand, is listed
  to the agent as waiting (`skill/list` gives `held: true`), not loaded and not readable, and the
  owner is told once per skill and hash (`notice.skillHeld`) with how to accept it:
  `binference skill accept <name>`, `/skills` in Telegram, or the console. `skill/accept`
  (`confirm`) takes the hash the owner was shown and refuses another (`skill.changed`). A file that
  exists but does not read accepts nothing until the owner accepts a skill again.
- **The file tools refuse a write or a removal inside a workspace skills folder**
  (`file.skill_folder`), and their words point to `skill_proposal`. The shell can still write
  there, since the workspace stays open to it; the hash gate keeps what it writes out of the
  index.

## Consequences

- The agent can grow and fix its own playbooks, and nothing it writes steers a later turn before
  the owner read it. The owner reads a diff, not a file tree.
- Skills the owner writes by hand in the workspace now wait for an accept, once per change.
- A proposal is lost with the state folder; backups hold databases, not `skill-review/`.
- The protocol gains `skillProposal/create|revise|list|get|apply|reject`, `skill/accept`, `held`
  on `skill/list`, the `skp_` id, the `skill.*` codes above and `file.skill_folder`; the notices
  `notice.skillProposed`, `notice.skillApplied`, `notice.skillRejected`, `notice.skillHeld` and
  `notice.skillAccepted`.
- Left out of v1: skill scripts, evaluations of a proposal by plugins, reviews of the whole
  collection and their backups, quarantine, and any mode in which the agent applies its own
  proposals. Each widens what an agent can do without the owner reading it, or adds a review step
  the owner did not ask for.

## Alternatives

- **Let the agent apply its own skills and tell the owner afterwards.** A planted skill would
  steer turns before anyone read it, and a later turn could trust it as the owner's.
- **Keep applied skills outside the workspace.** It would need a new place on every surface, and
  the hash gate already guards the workspace, so one place and one gate cover every skill the agent
  loads from it.
- **A database table for proposals.** The skills live in folders the engine reads as files; a
  proposal applies to those files, so keeping it beside them as a file keeps one kind of storage
  for skills and needs no migration.
