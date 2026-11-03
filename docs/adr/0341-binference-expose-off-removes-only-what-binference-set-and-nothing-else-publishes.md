# 0341. binference expose --off removes only what binference set, and nothing else publishes

Status: Accepted

Accepted by the owner on 2026-11-03, with the lead's rulings on the branch's second review of
the same day: the truth comes from Tailscale, never from the records.

## Context

Spec 1 section 7.9 gives `remote/disable` (`confirm`, braking): it "removes what binference
published, the engine's port stays on loopback". Spec 2 section 6.6 lists `remote.mini` and
`remote.webhooks` as live settings that "publish" the Mini App and the webhook path, and
`remote.publicUrl` as a restart setting. `remote/status` and `binference check` report
`funnel_extra`, `engine_exposed` and `serve_changed`.

Left open: which command removes the publishing, what it removes when the owner's own Tailscale
config sits beside binference's, what happens to webhook rules and the config, and whether a
change of `remote.mini` or `remote.webhooks` in `config.json5`, a start or a reload changes
Tailscale. Under [decision 0340](0340-binference-expose-serves-the-mini-app-on-443-and-funnels-only-the-webhook-path-on-8443.md)
binference's handlers survive reboots on their own (`--bg`). A record can go stale: the owner
changes Tailscale by hand, publishes the engine's port without binference, or set
`remote.publicUrl` before `binference expose` existed.

## Decision

- **`binference expose --off` runs `remote/disable`.** It first stops a running `expose` job and
  waits for its undo. It takes off binference's two handlers, each only while it is exactly as
  binference set it: `tailscale funnel --yes --https=8443 --set-path=/hook/ off`, then
  `tailscale serve --yes --https=443 --set-path=/ off`. Every other Tailscale setting stays. It
  asks no question: it only brakes.
- **It reads Tailscale back and says what is left.** After taking off, it reads `serve status`
  again. Any handler or TCP forward that still publishes the engine's port or the webhook
  listener's port, on any port, private or public, is named in `stillPublished`, with the
  `tailscale` command that takes it off, and `--off` exits 1. binference never touches it.
- **The records follow Tailscale.** `remote.mini` and `remote.webhooks` are written from what
  Tailscale holds after the read back, and `remote.publicUrl` is removed only when it names the
  Mini App's Tailscale address; the live reload journals and announces the change, as for any
  edit. They are written on the engine's own signal, so an `--off` sent from the Mini App, whose
  connection the change ends, still records. With no Tailscale CLI found while the records say
  something is published, `--off` fails `remote.tailscale_missing` and keeps the records.
- **Its own words.** A failed `--off` says why in words of its own, in English and Chinese, whose
  next step is `binference expose --off` again, never a publish.
- **Rules stay.** Active webhook rules keep their URLs; from outside they reach nothing until the
  webhook path is published again at the same name and port, when the same URLs work again.
- **Nothing else publishes.** The engine never runs Tailscale at a start, a reload or on a timer.
  `remote.mini` and `remote.webhooks` record what `binference expose` published; changing them in
  `config.json5` publishes and removes nothing.
- **What `check` fails, from Tailscale.** Whenever Tailscale's CLI is found, `check` reads it,
  whatever the records say: through the running engine's `remote/status`, at the ports the engine
  runs on, else in the CLI at the config's ports. `remote.funnel`: `funnel_extra` while any port
  is public with anything but binference's `/hook/` handler on 8443. `remote.loopback`:
  `engine_exposed` while any serve, funnel or TCP forward reaches the engine's port other than
  binference's private handler on 443, or the engine's port answers a connection on any of the
  machine's addresses beyond loopback. Both hold whoever set the handler. `remote.serve`:
  `serve_changed`, and the Tailscale state codes, while the records say binference published
  something that Tailscale does not hold as binference set it.

## Consequences

- The spec 2 rows of `remote.mini` and `remote.webhooks` change meaning: they record, they do not
  publish. Their apply time no longer matters to Tailscale. The `remote.publicUrl` row no longer
  names `funnel` as a way to publish the engine's port.
- An owner who removes binference's handlers with Tailscale's own CLI sees `serve_changed` until
  `binference expose` or `binference expose --off` runs.
- An owner who funnels a site of their own fails `binference check`, as decision 0051 asks: a
  public port beside the webhook path is outside what binference promises.
- An owner who published the engine's port by hand learns it from `check` and from `--off`,
  with the command that takes it off.
- To keep only the Mini App, the owner runs `binference expose --off`, then `binference expose`.

## Alternatives

- **The engine publishes from the config at start and on each reload.** A setting would then put
  a path on the internet with no question, and a start would change the owner's network on its
  own.
- **`tailscale serve reset` and `tailscale funnel reset`.** One call each, but they wipe the
  owner's own Tailscale config as well.
- **`--off` takes off every handler that reaches the engine.** Thorough, but it would remove
  what the owner set, which binference promises never to touch.
- **`check` trusts the records.** It costs no CLI call, but a handler published by hand, or one
  left after a failed `--off`, would pass.
- **`--off` removes only the public part, with a second flag for the Mini App.** One more flag to
  learn for a case that two commands already cover.
- **End the active rules when the path goes off.** A short `--off` would cost the owner every
  rule and a new card for each.
