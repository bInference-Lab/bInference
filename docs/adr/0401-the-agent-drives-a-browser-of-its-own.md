# 0401. The agent drives a browser of its own

Status: Accepted

Accepted by the tech lead on 2026-11-08.

## Context

The owner asked for an agent that works with anything on the computer. Much of that work sits
behind web pages that `read_page` cannot use: pages that draw themselves with scripts, forms, sign
ups, dashboards and sites that answer only a real browser. The agent already runs commands and
edits files on the owner's machine, so it needs a browser it can open pages in, read, click and
type into, and look at.

A browser that can reach anything can also reach binference itself: the engine's port and console
on the loopback, the Mini App's public address, and the state folder through `file://`. A page the
agent opens is written by someone else and may try any of these.

## Decision

- The agent gets `browse`, a machine tool with the actions `status`, `start`, `stop`, `tabs`,
  `open`, `focus`, `close`, `navigate`, `snapshot`, `screenshot`, `text`, `console`, `pdf` and
  `act`. `act` clicks, types, presses keys, hovers, selects, fills fields, scrolls, drags, waits,
  runs a script (`evaluate`), resizes the window and closes the tab. The engine serves it as
  `browser/run`, to the current agent runtime only.
- The browser is binference's own: a Chrome-family browser found on the machine, or the one
  `browser.executablePath` names, started with its own profile in `<state folder>/browser/default`
  and driven over a pipe, never a debugging port another program could reach. The owner's own
  browser profile, cookies and passwords are never read. One browser runs per install; it stops
  with the engine and after 10 minutes without a call.
- A snapshot is the page's accessibility tree with a ref on each element, which `act` names.
  `navigate` answers the loaded page's interactive elements, so the agent needs no snapshot after
  it. Every answer is cut to fit the tool result.
- Every request the browser makes, the page itself and each part, script and socket of it, passes
  one check first. It refuses binference's engine and webhook ports on any loopback address, the
  origin of `remote.publicUrl`, and any `file://` path inside the state folder but the agent's
  workspace, as the shell's wall does, its real path read through links. Loopback and private addresses, and names that resolve to them, are refused
  unless the owner sets `browser.allowPrivateNetwork`. Service workers are blocked, since their
  requests would pass outside the check.
- The browser goes through the owner's proxy (`network.proxy`, decision 0347) as every outbound
  request does, `network.noProxy` included; while that proxy cannot be read, the browser does not
  start.
- Every answer of `browse` marks the turn as outside content: a page may hold any words.
- `evaluate` is on by default (`browser.evaluate`); its result is cut to 4,000 characters.
- Screenshots and PDFs are saved in the workspace under `media/browser/<date>/`. The model reads a
  screenshot as `look_at_image` reads an image, and the answer names its path, so the agent can
  show it to the owner with `show_images`.
- Config migration 20 to 21 adds `browser.enabled` (true), `browser.headless` (unset: a window
  where the machine has a desktop, else headless), `browser.executablePath`, `browser.evaluate`
  (true) and `browser.allowPrivateNetwork` (false).

## Consequences

- The agent signs up, fills forms, reads script-drawn pages and checks sites for the owner.
- Sessions the agent signs in to stay in its own profile, inside the state folder, which the
  shell's wall already hides from the agent's commands.
- With no Chrome-family browser on the machine, `browse` refuses with the browsers to install and
  the setting that names one.
- A name the check resolved to a public address may resolve again inside the browser; a server
  that answers a second time with a private address could still be reached. The engine's own
  ports stay refused on every loopback address whatever a name resolves to.
- The tool texts tell the agent never to type the owner's secrets into a page; a credential the
  agent needs comes from the owner.

## Alternatives

- **Drive the owner's own browser.** It holds every session the owner has; a page the agent opens
  could act in all of them.
- **Start the browser with a debugging port.** Any program on the machine could take it over.
- **Check only the address the agent navigates to.** A page's own scripts, frames and sockets
  would reach what the agent may not.
