# 0340. binference expose serves the Mini App on 443 and funnels only the webhook path on 8443

Status: Accepted

Accepted by the owner on 2026-11-03, with the lead's rulings on the branch's second review of
the same day: a stopped call is undone, one remote job runs at a time, equal ports are refused,
and the job's time is 90 seconds.

## Context

[Decision 0051](../DECISIONS.md#d0051) publishes the Mini App over Tailscale `serve`, private to
the owner's tailnet, and only the webhook path over `funnel`, public on the internet; the engine's
port stays on loopback. Spec 1 section 7.9 gives `remote/enable` (`admin`, over IPC only) a job
that sets both, writes `remote.publicUrl` and `remote.webhooks`, and fails
`remote.tailscale_missing`, `remote.logged_out`, `remote.https_off` or `remote.funnel_denied`,
changing nothing. It puts the webhook address "on a port of its own, never the Mini App's".

Tailscale's documentation (kb 1242 `tailscale serve`, kb 1311 `tailscale funnel`, kb 1223 Funnel,
kb 1153 HTTPS, kb 1080 CLI) and its CLI set these facts:

- An HTTPS port is either private or public as a whole: the last `serve` or `funnel` on a port
  decides, and `funnel` publishes every handler on that port.
- Funnel listens only on 443, 8443 and 10000, needs HTTPS certificates, MagicDNS and the `funnel`
  node attribute, and lists the ports the node may use in a node capability.
- The docs give reverse proxies to `http://127.0.0.1`; the CLI also takes other local and remote
  targets, with a warning. A handler mounted at `/hook/` passes `/hook/<rest>` to its target with
  the mount removed, then joined to the target's own path.
- `--bg` keeps a handler across reboots and `tailscale down`; `--yes` skips the CLI's questions.
- With HTTPS off, `tailscale serve` prints a link to turn it on and may exit 0 having changed
  nothing, or wait for the owner without end. The daemon refuses an account that may not change
  its settings: on Linux one that is not Tailscale's operator, until `sudo tailscale set
--operator=$USER`; on Windows one that is not signed in to Tailscale ("Access is denied").
- The CLI writes a change through the daemon and may then wait, so a call killed at its time limit
  may have changed the config. Older CLIs print `null` for an empty serve config.
- The machine's name is written to a public certificate log once HTTPS is on, so anyone may find
  a funnel host and probe it.

The specs leave open which ports and paths binference uses, what it does when the owner's own
Tailscale config already uses them, whether the public part needs a yes at the terminal, what a
run that fails half way leaves behind, and the words for the failures the four codes do not
cover. `remote.publicUrl` applies at a restart (spec 2, section 6.6).

## Decision

- **The Mini App: port 443, the whole port, tailnet only.**
  `tailscale serve --bg --yes --https=443 --set-path=/ http://127.0.0.1:<engine.port>`. Its
  address is `https://<machine's Tailscale name>`, with `remote.mini: true`. It is written to
  `remote.publicUrl` when that is unset or already names it; an address the owner set there
  stays, and `expose` says so. The engine already serves only `/mini`, `/ws`, the console's files
  and the Mini App's uploads to that origin.
- **The webhook path: port 8443, one handler, public.**
  `tailscale funnel --bg --yes --https=8443 --set-path=/hook/ http://127.0.0.1:<engine.webhookPort>/hook/`.
  `remote/status`'s `webhookUrl` is `https://<name>:8443`, and `remote.webhooks: true` is written.
  The port is fixed, never 10000 as a fallback, so a rule's URL keeps its base from one run to the
  next. The listener already answers `404` to anything but an alert (decision 0333).
- **binference takes a whole port or none.** Before any change it reads `tailscale serve status
--json`, background and foreground sessions alike. A handler on 443 or 8443 that binference did
  not set (another path, another target, a TCP forward, plain HTTP, or `funnel` on 443) is
  `remote.port_taken`, and nothing changes. A port that holds exactly binference's handler is left
  as it is, so `expose` run again changes nothing.
- **Every check before any change.** No Tailscale CLI on `PATH`, in the OS's install folders,
  in Tailscale's macOS app or in `C:\Program Files\Tailscale` is `remote.tailscale_missing`. From
  `tailscale status --json`: the state is `Running`, else `remote.logged_out`; the machine has a
  Tailscale name and the `https` capability, else `remote.https_off`; for the webhook path, the
  `funnel` attribute, else `remote.funnel_denied`, 8443 among the funnel ports, else
  `remote.funnel_port`, and `engine.webhookPort` other than `engine.port`, else
  `remote.same_port`. So the CLI never reaches its HTTPS link or its wait.
- **Read back, and undo a half run.** After the calls, binference reads `serve status` again and
  finds the handlers it set, on the port and visibility it set. A refusal of the account is
  `remote.not_operator`; any other failure, a call that ran past its time or was stopped, or a
  read back that does not show the change, is `remote.not_applied`. Then every part this run asked
  for that a fresh read shows as binference sets it is taken off again, on 10 seconds of its own,
  never on the job's stopped signal, so a failed `expose` leaves Tailscale as it found it. Each
  CLI call has 10 seconds; the job ends within 90, the CLI's wait for it.
- **One remote job at a time.** A second `remote/enable` for the same parts answers the running
  job; one for other parts runs after it. `remote/disable` stops a running job, waits for its
  undo, then takes off (decision 0341).
- **The public part needs the owner's yes.** `binference expose` publishes the Mini App only.
  `binference expose --webhooks` also publishes the webhook path: at a terminal it first asks a
  yes or no question that names the public address; `--yes` answers it; with no terminal and no
  `--yes` it refuses before anything changes. `remote/enable` itself asks nothing: only the CLI
  over IPC can call it.
- **A restart applies the Mini App's address.** `remote.publicUrl` keeps its restart apply time.
  When the engine runs on another address, `expose` ends by saying `binference restart` makes the
  Mini App open at the new one; it does not restart the engine itself.
- **A rule's URL takes the published base.** `webhookRule/create` and `webhookRule/rotateUrl`
  read Tailscale before anything is stored: the funnel base while binference's funnel handler is
  there, else the loopback listener's (spec 1, section 7.5). One read is kept 5 seconds, shared
  with `remote/status`. While `remote.webhooks` records the path published and Tailscale does not
  answer, both fail with the Tailscale code and store nothing. The URL is still shown once and
  kept nowhere.

## Consequences

- New protocol codes, each with words and a next step in English and Chinese:
  `remote.port_taken`, `remote.same_port`, `remote.funnel_port`, `remote.not_operator`,
  `remote.not_applied`. `RemoteView` gains `published`, `problems` and `checkedAt`, as spec 1
  already gives them.
- An owner whose own site uses Tailscale on 443 or 8443 moves it, or keeps binference off
  Tailscale; binference never edits a handler it did not set.
- A webhook sender reaches only `/hook/` on 8443; the Mini App's port is never public.
- A rule made before `expose --webhooks` holds a loopback URL; the owner rotates it for the public
  one.
- Tests run a fake `tailscale` from a folder on the host's `PATH`, a Node script with a `.cmd`
  launcher on Windows; no test reaches a real Tailscale.

## Alternatives

- **Both parts with one `binference expose`, no question.** One step less, but a command named
  for the Mini App would put a path on the public internet without the owner reading it.
- **The Mini App and the webhook path on one port.** A port is public or private as a whole, so
  the Mini App would be public too.
- **Pick 8443, else 10000.** Works where a tailnet allows only 10000, but the base of every
  rule's URL would depend on the run.
- **Replace whatever holds the port.** `expose` would always succeed, and could silently turn an
  owner's private service public, or take down the site they run there.
- **Restart the engine at the end of `expose`.** The Mini App would work at once, but a command
  about publishing would stop the money path for a moment without saying so.
- **Undo only the calls that answered.** A call killed at its time limit may have changed the
  config already, and its handler would stay published.
