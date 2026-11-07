# 0396. A file watch that runs out of OS events checks the file on a timer

Status: Accepted

Accepted by the tech lead on 2026-11-07, on the owner's ask to fix the config watch on a Mac.

## Context

The live reload of `config.json5` (decision 0118) hears the file through the OS's file events. On
a Mac where other programs hold many watches, the folder's watch fails at once with `EMFILE: too
many open files, watch`. The engine logged `config.watch_stopped` and never reloaded the file
again, so a hand edit waited for a restart.

## Decision

- When the OS's file events fail, the watch reads the file again at once, so a change made
  meanwhile is not lost, and makes the watch again after 0.5, 2 and 5 seconds.
- If the events still fail, the watch checks the file every 100 milliseconds instead: a change of
  its size, time or file node is a change, and a file renamed over it too.
- Each step is logged, `config.watch_retrying` then `config.watch_polling`. A folder that does not
  exist still fails the watch at once.

## Consequences

- A hand edit of `config.json5` reloads on any machine, at most a tenth of a second late once the
  watch checks on a timer.
- A machine that runs out of file events pays one small file check ten times a second.

## Alternatives

- **Raise the machine's file limits.** Out of binference's hands; the limit is shared by every
  program on the machine.
- **Stop watching and reload only through binference's own writes.** A hand edit would then wait
  for a restart.
