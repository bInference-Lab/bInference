# 0400. The agent sends files on the machine as documents

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

The agent writes reports, exports trades and runs commands on the owner's machine, but it could
send the owner nothing but text and pictures. The owner asked for an agent that works with
anything on the computer, which includes handing back the files it makes or finds.

## Decision

- The agent gets `send_files`, a control tool: up to 10 files on the machine, by path, with a short
  caption. The engine's `file/send` reads each as `file/read` reads a path, so binference's own
  folder stays walled off and `files.workspaceOnly` holds, at most 20 MiB each, every file before
  any is sent, and pushes them as `chat/files`.
- Surfaces read a sent file's bytes by its id with `file/fetch`, 512 KiB a part, read again where it
  is and held in memory for 2 minutes while its parts are read, at most two files at once; the
  ids of the last 64 files are kept. `file/fetch` is a read the owner's Telegram chat may call.
- Telegram sends each file as a document named as on the machine and captioned with where it is;
  the console lists each with a button that saves it on the owner's device; terminal chat prints
  where each is.
- `show_images` stays for pictures to look at in the chat; `send_files` is for files to keep.

## Consequences

- The owner gets reports, exports, logs and archives the agent makes, in the chat they use.
- A file over 20 MiB is refused with the next step: tell the owner where it is, or make a smaller
  copy. Telegram itself takes up to 50 MB from a bot; 20 MiB bounds the engine's memory.
- A sent file that moves or goes before a surface reads it shows by its path alone.

## Alternatives

- **Send files through `show_images`.** Telegram shows a photo compressed and a document whole, and
  the agent needs to say which the owner gets.
- **Copy each sent file into the workspace.** It would fill the workspace with copies.
