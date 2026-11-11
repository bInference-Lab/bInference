# 0412. The image runs the agent's commands as a user of their own through a shell launcher

Status: Accepted

Amends [decisions 0292](../DECISIONS.md#d0292) and [0344](../DECISIONS.md#d0344).

## Context

[Decision 0378](../DECISIONS.md#d0378) says that in the Docker image the agent's commands run as an
OS user of their own, which cannot read the engine's files, and elsewhere behind the platform's
command wall. The image was built without that user. What the shell did in the image on
2026-11-11, read from the image's run base and the code:

- The base holds no bubblewrap, so the Linux wall answers `none` and every command answers
  `shell.no_wall`: the agent has no shell in the image.
- Installing bubblewrap does not help. Docker's default seccomp profile and capabilities refuse it
  a new namespace, as root ("Creating new namespace failed: Operation not permitted") and as a
  user. The Linux wall reports that it holds once `bwrap` is installed, without trying it, so every
  command would then fail to start with bubblewrap's error.

Three facts shape the fix:

- A process that is not root cannot start another under a different user
  ([decision 0344](../DECISIONS.md#d0344)), so only the image entry can start the user's process.
- The state folder is owner-only (0700), so a second user cannot reach the workspace inside it. A
  state folder the group may cross would need every file in it closed to the group by its mode,
  and `binference check` would fail it.
- Node's start of a child under another user clears its supplementary groups, so a group shared by
  the engine and that user needs another way in.

## Decision

- **A third user.** `binference-shell` (uid and gid 10003) runs the shell launcher and every
  command. `binference` is a member of its group in `/etc/group`; no other user is.
- **One volume, three folders.** The state volume, `/var/lib/binference/.binference`, holds three
  folders the image makes at build time, so a new named volume takes their owners and modes. The
  volume's root is `binference`'s with the `binference-shell` group (0750), and the plugin user
  reaches none of it.
  - `state/`, the state folder, which `BINFERENCE_HOME` names: `binference`'s, 0700, as before.
    The shell user cannot cross it, so `auth/`, `keys/`, the databases, `config.json5` and `run/`
    stay out of its reach by owner and mode.
  - `workspace/`, the agent's workspace, which `BINFERENCE_WORKSPACE` names: `binference`'s with
    the `binference-shell` group, 2770, so both write it and what they make keeps the group.
  - `shell/` (`binference`'s with the `binference-shell` group, 0750) holds `run/`, the shell
    user's with the engine's group (0750), where the launcher's socket only the engine's group
    opens, and `home/`, the shell user's home (2770 with its own group).
- **`BINFERENCE_WORKSPACE`** moves the workspace out of the state folder, as `BINFERENCE_HOME`
  moves the state folder. It is not a config key. The workspace stays on the state volume, so a
  backup reads it and a restore moves it within one file system. At each start the engine gives
  the workspace folder the shell's group and the mode 2770 again when it lacks them, as after a
  restore put it back owner-only; a folder it cannot change is logged, and the start goes on.
- **The image entry** starts a third child: the shell launcher, `node --disable-sigusr1
shell-launcher.mjs`, as `binference-shell` in `/`, with no variable. It starts it again 1 second
  after it ends while the engine runs, and when the engine ends it stops it as it stops the plugin
  launcher, with 10 seconds before `SIGKILL`. It starts the engine through util-linux's `setpriv
--init-groups`, so the engine holds the groups `/etc/group` gives it. Every child starts with
  the file mode mask 0002, so what the engine makes in the workspace stays writable to the group.
  It still takes no argument and opens, makes, changes or removes no path. A `binference` command
  run as root in the container drops to `binference` with no group but its own, as before.
- **The shell launcher** takes no argument and reads no variable; its socket and home are the
  image's. It listens on `shell/run/launcher.sock` and sets its file mode mask to 0007. A
  connection's first line, at most 1 MiB, is one command: its line, its folder, its time limit and
  its environment, with `HOME` set to the home and `USER` and `LOGNAME` to its user. It runs it in
  bash without startup files, in a process group of its own, and writes the output and the end as
  JSON lines. A `stop` line or the connection's close ends the command with everything it
  started, gently, then by force after 5 seconds.
- **The engine trusts nothing the launcher sends.** A command runs as the launcher's user, so it
  can end or replace the launcher, which gains it nothing. Each line is checked, a line over 1 MiB
  or one out of shape ends the connection, and the output is outside content as before. The
  engine ends a command that outlives its stop or its time limit by 10 seconds itself.
- **One port.** `BINFERENCE_SHELL_LAUNCHER` names the socket, and the platform then gives the
  engine the launcher in place of a command wall, through the same `ShellLauncher` port. The
  shell tools, requests and answers ([decision 0409](../DECISIONS.md#d0409)), end notices, masking
  and limits do not change. A command starts in the shell user's home unless it names a folder,
  and `~` names that home for the shell and the file tools alike.
- **Files the two users share.** A command's file in the workspace or the shell's home is the
  group's, read and write, so the engine's file tools, skills and backups read and change it. The
  engine's file in the workspace is the group's with write, so a command changes it. A folder the
  engine keeps owner-only stays closed to commands, as each agent's `workspace/<agent>/` with its
  `STRATEGY.md`, notes and skills does, and the work folders of speech and screenshots, with
  `media/` above them when they made it. A file the file tools make takes the process's file mode
  mask, so under 0002 it is the group's to write.
- **The check.** `binference check` reports `shell.wall`: the wall that holds (`os_user` in the
  image, `seatbelt` on macOS, `bubblewrap` on Linux) or why none holds, and in the image whether
  the launcher answers.

## Consequences

- The state folder moves inside the image to `/var/lib/binference/.binference/state`. No image
  was ever published, so no volume holds the old layout. The server guide's commands keep their
  volume; its troubleshooting line names the new path.
- A folder bound in place of the named volume needs the three folders with these owners and
  modes. Without `shell/run` the launcher cannot listen, `shell.wall` says so, and commands fail to
  start.
- A command that ends the launcher leaves its own running commands to run on as the shell user;
  the engine reads their end as lost.
- Files a restore puts in the workspace are owner-only, as every restored file is, until the agent
  writes them again.
- Every child of the image entry starts with the mask 0002 instead of 0022; the engine's group
  holds no other user.
- The Linux wall outside the image and Windows are unchanged and stay unproven here.

## Alternatives

- **Bubblewrap in the image.** Docker refuses it new namespaces unless the container runs
  privileged or without its seccomp profile, which widens what every process of the image can do.
- **Capabilities for the engine.** As in [decision 0344](../DECISIONS.md#d0344): a compromised
  engine could make itself root.
- **A state folder the shell's group may cross (0710).** Every file in it would need a mode closed
  to the group, one missed would leak, and the owner-only check would fail it.
- **A workspace volume of its own.** A restore could not move the workspace in one rename across
  two file systems, and the guide would gain a third volume.
- **The launcher handing files back.** Changing a file's owner needs root.
