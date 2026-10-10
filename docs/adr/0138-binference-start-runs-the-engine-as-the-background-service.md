# 0138. binference start runs the engine as the background service

Status: Accepted

## Context

The engine runs unattended: auto orders, watchers and the owner's bot only work while it runs.
ARCHITECTURE.md sections 22 and 24 name a background service on every OS (a LaunchAgent, a
`systemctl --user` unit, a scheduled task), started at the owner's login and restarted after a
crash, and the platform's `ServiceManager` installs, removes and reports one. Until now
`binference start` ran the engine in the terminal that started it, and nothing installed the
service. The specs do not say which command installs it, what `stop` means for a service the OS
starts again at login, where its output goes, or how a service finds a state folder that
`BINFERENCE_HOME` moved.

## Decision

- `binference start` installs the service `engine` and starts it. The OS runs
  `binference start --foreground` with the same Node, the same Node options and the `--set` flags
  of the `start` that installed it, from the state folder, at each login and after an exit with an
  error. The config is checked before anything is installed. `start` waits up to 90 seconds until
  the engine answers past `starting`, then names its IPC address, its log (`logs/engine.log`) and
  the service's own output (`logs/service.log`). An engine that never answers has its service
  stopped again, so it does not restart every 10 seconds until the next login.
- `binference start --foreground` runs the engine in that process, as before. The service runs
  it, and so do Docker and a person who wants the engine in a terminal.
- A second `start` leaves a running service as it is and exits 0; `restart` picks up a new
  version or new flags. A `start` while an engine runs in a terminal on the same state folder is
  refused with `engine.already_running`.
- `binference stop` asks the engine for its shutdown sequence over IPC, then has the OS stop the
  service and keep it, so it starts again at the next login. On Windows the OS ends a task's
  program without a signal Node can hear, so the request over IPC is what runs the shutdown
  sequence there. With no service, `stop` stops an engine that runs in a terminal. It waits until
  the engine lets go of the state folder.
- `binference restart` is a `stop`, then a `start`.
- The service runs on the state folder in the owner's home folder. With `BINFERENCE_HOME` set,
  `start` and `restart` refuse with `service.home_moved` and point to `--foreground`, and `stop`
  never touches the service.

## Consequences

- An owner runs one command once, and the engine runs at every login after it.
- Every test and tool that ran the engine in its own process now passes `--foreground`.
- The service does not see the variables of the shell that ran `start`: a secret source
  `{ fromEnv }` resolves in the service only when the OS session sets that variable. The config's
  other secret sources work as they do in a terminal.
- `stop` keeps the service, so the engine comes back at the next login; removing the service is
  `binference uninstall`'s job.

## Alternatives

- **A `service` command group (`service install`, `service start`).** More commands for one job,
  and the plan names `binference start` as the command that installs the service.
- **`stop` removes the service.** The next login would not start the engine, and a stop for
  maintenance would need a new `start` to come back. The OS's own stop (launchd's bootout,
  `systemctl stop`, Task Scheduler's end) keeps the service, and so does this.
- **The service carries `BINFERENCE_HOME`.** launchd and systemd units take environment
  variables, but a scheduled task does not; it would need a generated script on Windows, or a new
  command-line option for the state folder. Either needs its own decision.
- **The service carries the whole environment of the shell.** It would write secrets that
  `fromEnv` sources name into the unit files.
