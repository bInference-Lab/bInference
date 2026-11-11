# 0409. The owner answers shell requests and the agent hears when a command ends

Status: Accepted

## Context

[Decision 0378](0378-the-agent-runs-shell-commands-behind-a-wall-around-binference-s-own-secrets.md)
set the shell's policy: `shell.run` (`off`, `listed`, `any`), `shell.ask` (`never`, `unlisted`,
`always`) and `shell.onNoAnswer` (`refuse`, `listed`, `any`), allowed commands kept by the engine,
requests that wait 10 minutes and that any owner surface answers. It left open how a command line
is judged against the list, what "Always allow" keeps, how a request waits while a tool call has
60 seconds and an engine answer 30, and what the agent hears of a command it left running. Today
the agent can only poll such a command with `shell_job`, and a command that ends while no turn
runs reaches nobody.

## Decision

- **Judging a line.** A command line is split into its steps at `|`, `|&`, `&&`, `||`, `;` and
  line breaks. Each step's first word is its program: a word with a `/` is a path from the
  command's folder, any other is looked up on the command's `PATH`; either is read as its real
  path. A step matches an allowed command only when the program, every argument word for word and
  the start folder's real path are the same. A line is listed only when every step matches.
- **What never matches.** A line binference cannot judge in full: command or process
  substitution, variables, redirects and heredocs, globs, braces, a leading `~` or `=`, a trailing
  or lone `&`, subshells and groups, `if`, `for` and the other compound words, comments, line
  continuations, an unclosed quote, an empty step, a step that starts with a variable assignment,
  or a step that is a shell word that runs other code or moves the folder (`eval`, `source`,
  `exec`, `cd` and their like). A program that cannot be found never matches. On a machine whose
  shell is PowerShell no line matches.
- **Always allow** keeps each step of the line as one allowed command: its program, its arguments
  and its folder, shown as the step was written. It is not offered for a line that never matches,
  nor when a step runs a shell, an interpreter or a launcher that runs other code (`bash`,
  `python`, `node`, `env`, `sudo`, `xargs`, `find`, `make`, `npx` and their like), since what such
  a step does can change while its words stay the same. Allowed commands are install-wide, kept in
  `shell_allowed` (engine migration 0064), journaled under `shell.allowed` and announced with
  `notice.shellAllowed` and `notice.shellDisallowed`.
- **When a command asks.** `shell.ask: always` asks for every command; `unlisted` for every
  command not listed; `never` asks for none, and under `shell.run: listed` refuses an unlisted one
  with `shell.not_listed`. A request names the command, its folder, why it asks (`always`,
  `unlisted`, `unreadable`, `powershell`) and whether Always allow is offered.
- **The turn ends while a request waits.** `shell/run` answers `asking` with the request and the
  job the command will run as, and the tool ends the turn, as a credential request does: a call
  has 60 seconds and an engine answer 30, which a 10-minute wait cannot fit. One request is open
  per agent; a new one replaces the older, which never runs, and `shell_job stop` withdraws it.
- **An answer runs the command.** The first answer wins, from any surface with the `confirm`
  scope; the agent runtime and MCP clients hold none. Allow once and Always allow start the command
  at once as the request's job, in its folder, with its time limit; the engine waits up to 10
  seconds and wakes the agent with the result, or with the job it runs as. Refuse wakes the agent
  with the refusal.
- **No answer.** At 10 minutes `shell.onNoAnswer` decides, never more than `shell.run` allows:
  `refuse` closes the request with no turn, as a credential request that runs out does; `listed`
  runs a command listed by then; `any` runs it. A command that runs wakes the agent with its
  result.
- **The end of a command left running.** A job whose call answered `running` and whose end the
  agent has not read wakes the agent when it ends, through the engine, as a helper's report does:
  its exit code or signal, how long it ran, and the last 20 lines, at most 2,000 characters, of
  the output it has not read, masked and marked as outside content. A job that ends with exit code
  0 and no new output wakes nobody unless `shell.tellOnQuietEnd` is `true`. A job the agent
  stopped itself wakes nobody.
- **Stops and restarts.** The owner's `/stop` and a freeze stop every running command of the agent
  and close its open request; they wake nobody, and a later read of the job says who stopped it.
  A frozen or archived agent is not woken. Each job the agent waits to hear of is kept as a row in
  `shell_watches` (engine migration 0064) until it is told, so a job a restart lost wakes its agent
  at the next start, saying so. Open requests are not kept: the turn that asked is gone.
- **Telegram** shows a request in the owner's private chat with Allow once, Always allow (when
  offered) and Refuse. Each button's data carries the request's id: a request lives 10 minutes in
  memory, and the engine answers a press only for the owner's Telegram id.

## Consequences

- `listed` and `unlisted` work as the owner expects of a list: an allowed `git status` in one
  folder covers that command there, never `git push` or another folder.
- Lines with shell features are always asked under `unlisted`; the owner can answer them once.
- An allowed command is bound to its words, not to what its program reads: a program that reads a
  file the agent can write, such as a repository's `.git/config` or a tool's settings in the home
  folder, does what that file says. Asking is oversight of what the agent runs; the wall of
  decision 0378, the cards and the Privy ceiling stay what bounds binference's secrets and money.
- The agent stops polling a command it left running: its end arrives as a message.
- `/stop` now ends a long command the agent started, such as a server; the agent can start it
  again in a later turn.
- Settings, protocol and store grow: config 23 adds `shell.ask`, `shell.onNoAnswer` and
  `shell.tellOnQuietEnd`; the protocol gains `shell/answer`, `shell/requests`, `shell/allowed`,
  `shell/disallow`, the `asking` status and the request pushes, all additions to version 1.

## Alternatives

- **Hold the tool call until the owner answers.** It cannot outlast the 60-second call limit, and
  a 10-minute wait would hold the turn and its queue.
- **Match a program by name alone.** An allowed `rm` would then allow every `rm`; binding the
  arguments and the folder keeps an answer to what the owner read.
- **Wake on every end, an empty success too.** A quiet success needs no turn, and each turn spends
  the model budget.
- **Keep running commands through `/stop`.** `/stop` stops the agent's helpers and goal turns; a
  command it left running is the same kind of work.
