# 0344. The image runs community plugins under an OS user of their own through a plugin launcher

Status: Accepted

Accepted by the owner on 2026-11-03.

## Context

[ARCHITECTURE.md section 14](../ARCHITECTURE.md#section-14) and
[decision 0300](0300-each-community-plugin-runs-in-a-process-of-its-own-that-speaks-only-to-the-plugin-host.md)
say the Docker image runs plugins as an OS user of their own: Node's permission model does not
cover signals, so a plugin under the engine's user can end the engine with `process.kill` and,
where the debug signal is not off, open its debugger
([decision 0343](0343-the-plugin-host-runs-each-community-plugin-as-a-sealed-program-and-probes-every-gap-first.md)).
Under another user the kernel refuses both.

The image ([decision 0292](0292-the-docker-image-runs-binference-as-its-own-user-on-a-state-volume.md))
runs everything as `binference` (uid 10001), with the state folder owner-only (0700). A process
that is not root cannot start another under a different user on Linux; it needs root or the
`CAP_SETUID` and `CAP_SETGID` capabilities. Docker's default seccomp profile refuses new user
namespaces to a process without `CAP_SYS_ADMIN`. A plugin user can reach nothing inside the
owner-only state folder, so plugins' files need a place outside it.

## Decision

- **Two users.** `binference` (uid and gid 10001) runs the engine, the runtime and the signer, as
  now. `binference-plugin` (uid and gid 10002) runs the plugin launcher and every community
  plugin. Plugins share that user: one plugin can signal another or the launcher, never the
  engine.
- **The image entry**, `binference-image`, is the one process that runs as root. It takes no
  argument and reads no input; it passes the container's variables to the engine as they are,
  with `HOME` set to the engine's home, and none to the launcher. It opens, makes, changes and
  removes no path: its only acts on the system are starting its two children and signalling them.
  It refuses to start, with one line naming the flags it needs, unless it runs as root and not as
  process 1. Then it:
  1. starts the launcher, `node --disable-sigusr1 plugin-launcher.mjs`, as `binference-plugin`,
     in the plugins' volume;
  2. starts the engine, `node --disable-sigusr1 /opt/binference/dist/main.mjs start
--foreground`, as `binference`, in `/var/lib/binference`, with the container's standard
     output and error.
- **Signals.** `SIGTERM` and `SIGINT` to the image entry go to the engine as `SIGTERM`. It starts
  and signals nothing else.
- **When a child ends.** When the launcher ends or fails to start while the engine runs, the
  image entry starts it again after 1 second, every time: a plugin can end the launcher, which
  only stops plugins. When the engine ends, the image entry sends the launcher `SIGTERM`, then
  `SIGKILL` after 5 seconds, and exits with the engine's exit code, or 128 and the signal's number
  for an engine a signal ended, so the container ends with the engine and Docker's restart policy
  applies. No error of a child ends the image entry while the engine runs.
- **The launcher** listens on `/var/lib/binference-plugins/run/launcher.sock`. The image makes
  `run/` for the plugin user with the engine's group (0750), inside the volume's root, which only
  `binference` may change, so the plugin user can neither replace the folder nor let anyone but
  the engine's group in. The launcher, as the plugin user, removes a socket a launcher before it
  left there and listens. A connection's first line names one plugin id, at most 256 bytes;
  anything else closes it. The launcher picks the plugin's folders from the id and the arguments of
  decision 0343 itself, never from what the engine sends, starts the plugin with no variable in
  its package folder, watches its resident memory, and relays its standard input and output as
  bytes. The plugin ends with its connection. The engine trusts nothing it relays.
- **Folders.** The second volume, `/var/lib/binference-plugins`, holds `packages/<id>`, each
  plugin's files, owned by `binference` (0755, so the plugin user reads and never writes them),
  `data/<id>`, each plugin's data folder, which the launcher makes owner-only for the plugin user
  under `data/` (0700, owner `binference-plugin`), and `run/`. The trees are apart because a folder
  owned by one user cannot hold a folder the other makes. The probe plugin's package is the one
  the image ships, and its data folder is `data/sandbox-probe`.
- **How it runs.** The engine's container runs as `docker run --init --user root --entrypoint
binference-image`. `--init` puts Docker's init in front, which reaps a plugin left when a
  plugin ended the launcher. Every other command runs as `binference`: a `binference` command
  started as root, as `docker exec` into the engine's container and the health check are, drops
  to `binference` (`BINFERENCE_IMAGE_USER`) before it does anything, so no file in the state
  folder is ever made by root. The image sets `BINFERENCE_PLUGIN_LAUNCHER` to the socket and
  `BINFERENCE_HOME` to the state folder. A container started otherwise has no launcher, and its
  sandbox check fails, so it runs no plugin.
- **Outside the image** plugins keep running under the owner's own user, and `binference check`
  warns that a plugin could signal the engine (decision 0300).

## Consequences

- A root process with no input, no network and no file of its own stays in the container for
  its life.
- The server guide's engine command gains `--init`, `--user root`, `--entrypoint
binference-image` and the second volume; an engine started without them runs, and runs no
  plugin.
- `pnpm test:image` checks that `binference check` in the container finds the sandbox holding
  with plugins under their own user, that only Docker's init and the image entry run as root,
  that a command run as root drops to `binference`, and that a link the plugin user plants in its
  own folder, with the launcher ended, leaves the state folder as it was and the launcher back.

## Alternatives

- **Capabilities for the engine.** A copy of `node` with `cap_setuid,cap_setgid+ep` for the
  engine alone could start each plugin under a user of its own. A compromised engine could then
  make itself root in the container, `--security-opt no-new-privileges` turns file capabilities
  off, and the runtime and signer would need the plain `node`.
- **A second container for plugins.** The cleanest split, but the image is no longer one
  container: the server guide needs Compose.
- **Root as the image's default user.** The engine would start without extra flags, but every
  `docker exec` would run as root and could leave files in the state folder the engine cannot
  read.
- **Keep one user.** No change to the image; plugins could end the engine.
