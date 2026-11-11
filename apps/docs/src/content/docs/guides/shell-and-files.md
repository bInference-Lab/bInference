---
title: The shell and files
description: Let the agent run commands and change files on your machine, behind a wall around binference's own folder, and choose which commands ask you first.
---

Your agent can work on the machine binference runs on: it runs commands with its shell and reads
and changes files with its file tools. Both act as your own OS user, so they reach what you can,
apart from binference's own folder. Neither can confirm a card, change a limit or reach a key.

## The wall

binference's state folder, `~/.binference` by default, holds the keys, the databases,
`config.json5`, the CLI's token and the engine's socket. The agent's commands and file tools never
read or change anything in it, apart from its `workspace/` folder, which stays open to the agent. A
link into the folder does not get through either: each path is read at its real path, and a file
call uses only the file it checked.

- On macOS, a Seatbelt rule set walls every command. Commands cannot reach the keychain either.
- On Linux, bubblewrap walls every command. Install `bwrap`; without it, every command is refused
  with a message that says so.
- Windows has no wall yet, so the agent's shell is off there.

A command never runs without the wall. Everything else your user holds stays within its reach: your
other files, and the network. What keeps your money safe stays the cards, the limits and the ceiling
of the [safety guide](/guides/safety/).

## The shell

`shell` runs one command line in your login shell, and the agent reads what it prints, standard
output and error together, with its exit code. A command starts in your home folder unless the agent
names another. It reads none of the shell's startup files, such as `.zshrc`, so their aliases and
`PATH` lines do not apply. It gets the environment binference started with, less binference's own
variables and every variable a secret source in `config.json5` reads. It reads no input, so the
agent passes every answer in its arguments.

The agent waits up to 20 seconds for a command to end, 10 unless it asks for more. A command still
running then goes on as a job, which `shell_job` reads or stops; a server or a long build can start
as a job at once. A command stops after `shell.timeoutSeconds`, 1,800 seconds by default, unless the
agent names another limit; 0 means none. A job is kept 30 minutes after its command ends, and none
outlives a restart of binference.

When a job the agent left running ends, the agent hears it in a message: its exit code, how long it
ran and its last 20 lines. A job that ends with exit code 0 and prints nothing new stays quiet,
unless `shell.tellOnQuietEnd` is `true`. Stop in the console, Esc or `/stop` in the terminal chat,
and a freeze stop every command the agent runs.

## Commands that ask you first

Three settings decide what runs:

| Setting            | What it decides                                                                                                                       | Default  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `shell.run`        | `any` runs any command; `listed` only the commands you allowed always; `off` none                                                     | `any`    |
| `shell.ask`        | `never` asks for none; `unlisted` for each command you did not allow always; `always` for every command                               | `never`  |
| `shell.onNoAnswer` | What a request you leave 10 minutes unanswered does: `refuse` runs nothing; `listed` runs it if you allowed it by then; `any` runs it | `refuse` |

By default every command runs at once. With `shell.ask` at `unlisted` or `always`, a command waits
for your answer: Allow once, Always allow or Refuse. The agent's turn ends while it waits, and your
answer starts its next turn with what came of the command. An agent has one open request at a time;
a newer one replaces it, and the older one never runs.

Answer a request on any surface:

- In Telegram, it comes to your private chat with the three buttons.
- In the console, it shows above the message box.
- In the terminal chat, press 1 to allow once, 2 to always allow and 3 to refuse; without Always
  allow, 1 allows once and 2 refuses.
- In a shell, `binference shell requests` lists the requests, `binference shell allow <request>`
  runs one once, `--always` keeps it as an allowed command, and `binference shell refuse <request>`
  refuses it.

The first answer counts. After 10 minutes, `shell.onNoAnswer` decides, never more than `shell.run`
allows.

### Allowed commands

Always allow keeps each step of the command line as an allowed command: the program at its real
path, every argument word for word, and the folder it starts in. An allowed `git status` in one
folder covers that command there, never `git push` and never another folder. A line of several
steps, joined by `|`, `&&` or `;`, is allowed only when each step is.

Some lines binference cannot judge in full, and they always ask under `unlisted`: lines with
variables, redirects, globs, command substitution, subshells, `if` or `for`, and steps such as
`eval`, `source` or `cd`. Always allow is not offered for them, nor for a step that runs other code,
such as `bash`, `python`, `node`, `env`, `sudo`, `xargs`, `find`, `make` or `npx`.

`binference shell allowed list` shows the allowed commands, and
`binference shell allowed remove <allowed>` takes one back. Each change is announced with the
[`shellAllowed`](/reference/notices/#shellallowed) or
[`shellDisallowed`](/reference/notices/#shelldisallowed) notice.

An allowed command is bound to its words, not to what its program reads. A program that reads a
file the agent can write, such as a repository's `.git/config` or a tool's settings in your home
folder, does what that file says. Asking you is a check on what the agent runs; the wall, the cards
and the ceiling stay what keeps binference's secrets and your money safe.

## What the agent reads back

Everything a command prints is outside content: any program, file or page can put words into it.
Once the agent reads it, the chat is marked as after a web page, so a card that follows carries a
warning and auto mode asks on every card until you send `/clear`.

Before the agent reads the output, binference hides private keys in PEM form and recovery phrases of
12 words or more. A bare private key written as hex stays, since a transaction hash looks the same.

## The file tools

| Tool         | What it does                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `file_read`  | Reads a text file a page at a time, up to 2,000 lines or 10 KB, and says where the next page starts; describes an image file instead |
| `file_write` | Writes a file whole, making its folders                                                                                              |
| `file_edit`  | Replaces exact texts in one file                                                                                                     |
| `file_patch` | Changes several files in one patch, and writes nothing unless every change is found                                                  |

A path is absolute, starts with `~/` for your home folder, or is relative to the workspace folder.
A file is read or written up to 10 MiB. A write replaces a file through a new file beside it and
keeps its permissions. An edit finds its text exactly, or by a loose match that ignores trailing
spaces and reads curly quotes and dashes as plain ones; either way the text must be found once. A
PDF goes to `read_pdf` instead, as the [pictures guide](/guides/media-and-screen/#pictures-and-pdfs)
shows.

Two settings decide where the file tools reach:

- `files.workspaceOnly`, `false` by default: `true` keeps reads, writes and edits inside the
  workspace folder.
- `files.patchWorkspaceOnly`, `true` by default: patches change only files in the workspace folder;
  `false` lets them reach any file outside binference's own folder.

The file tools refuse:

- a path in binference's own folder, its workspace aside
- a path outside the workspace folder while a setting keeps them there
- a write or a removal in a workspace skills folder: the agent changes its skills only through a
  [skill proposal](/guides/helpers-and-goals/#skills-the-agent-writes) you apply
- a path that leads to another file while binference checks it, such as a link moved at that
  moment: nothing is read, written or removed, and the agent reads the path again
- a folder, a file that is not text, and a file over 10 MiB

What `file_read` shows is outside content too, and it is shown as it is: a key written in a file
reaches the agent unmasked.

## See also

- [Commands](/reference/commands/) for `shell`.
- [Config keys](/reference/config/) for `shell.*` and `files.*`.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for `shell`, `shell_job` and the file
  tools.
