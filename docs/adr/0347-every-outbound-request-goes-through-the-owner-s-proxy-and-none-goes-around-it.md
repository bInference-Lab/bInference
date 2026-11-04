# 0347. Every outbound request goes through the owner's proxy, and none goes around it

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

Owners in mainland China reach Telegram, the model providers, Privy and most RPC nodes only
through a proxy. [Spec 2](../specs/config.md#section-6-6) has carried `network.proxy` (a secret
source) and `network.noProxy` since the first config, but no part read them, and
[decision 0230](0230-a-setting-applies-at-its-part-s-next-use-and-a-looser-fee-cap-after-a-restart.md)
listed `network` as restart-only.

Every HTTP request of the engine goes through one adapter of the `Http` port, and every request of
the agent runtime through one `StreamingHttp` adapter, both on undici. The chains' block
subscriptions open WebSockets. The signer reaches no network at all. The engine's IPC socket, the
runtime's link to it and the console are local sockets, not HTTP requests.

undici 8.11's `ProxyAgent` (its documentation in the package, `docs/api/ProxyAgent.md`) tunnels an
`https:` request with `CONNECT`, takes the user name and password from the proxy URL, and with
`proxyTunnel: true` tunnels `http:` requests too. Its `EnvHttpProxyAgent` reads the environment and
knows no address blocks. undici's `WebSocket` takes a dispatcher (`docs/api/WebSocket.md`).

## Decision

- **One route, read once per change.** The engine reads `network.proxy` from its secret source
  before any part reaches the network and puts one route in force on its outbound adapter: every
  request and WebSocket goes through the proxy as a `CONNECT` tunnel, `http:` hosts included, so
  the proxy's answer to the tunnel is never read as the host's. The agent runtime gets the proxy in
  its settings line (runtime spec, section 2.2) and routes its model calls and web tools the same
  way. The environment's `HTTP_PROXY` and `NO_PROXY` count only when config names them as a secret
  source, as spec 2's example does.
- **What never goes through it.** `localhost`, any name under `.localhost`, and any IP address
  that is not on the internet (loopback, private, link-local, carrier-grade NAT, unique local and
  the other blocks the URL guard refuses) connect directly, whatever the lists say: a proxy
  elsewhere cannot reach them, and a local RPC or model server must keep working. The engine's
  IPC, the runtime's link and the console are local sockets and never reach the adapter.
- **What does go through it.** Telegram, the model providers, Privy, every RPC and relay by name,
  the risk, market and bridge APIs, browser push and plugin fetches. Privy goes through it like any
  host: the owner set the proxy because the direct path is closed or watched, the request body is
  signed and the TLS session ends at Privy, so the proxy sees only the host name. The signer has no
  network, so nothing of it can.
- **Skill installs.** `skill/add` runs `git` and `npm`, which reach the network themselves: they get
  the proxy and the no-proxy list in their environment alone, never their arguments, through the
  variables git (`http.proxy`, read from `https_proxy` and its kin) and npm (`proxy`, `https-proxy`,
  `noproxy`) document; without a proxy, every such variable the engine inherited is removed. An
  `ssh://` source cannot go through an HTTP proxy, so it is refused while a proxy is set
  (`skill.ssh_through_proxy`), and every fetch is refused while the route is held
  (`skill.proxy_held`).
- **The no-proxy list.** `network.noProxy` takes `*`, a host name that also covers the names under
  it (`example.com`, `.example.com` and `*.example.com` alike), an IP address or `[IPv6]`, each with
  an optional `:port`, and address blocks such as `10.0.0.0/8`, at most 256 entries of at most 300
  characters, as the runtime's settings line carries; an entry it cannot read fails the config's
  load. Names are written in punycode, a name's last label is no number, and a name covers names
  alone, never an address; an IPv4-mapped address matches its IPv4 form. Names are matched as
  written, never resolved.
- **Fail closed.** The outbound adapters refuse every request and socket until a command puts a
  route in force (`http.no_route`), and every command that reaches out does: the engine, the agent
  runtime from its settings, `check`, `init`, attach, rebuild and backup restore. A proxy that
  cannot be read, or is no `http:` or `https:` URL, holds every request it would carry with
  `http.proxy_unusable`; nothing goes around it. The log names the code (`network.proxy_held`),
  never the source or the value.
- **Public-only requests.** A request held to public addresses (a page the model names, a plugin
  fetch, browser push) through the proxy has its name resolved here first and is refused when any
  address it gets is off the internet. An `http:` one is then sent to the address checked here,
  its name in `host`, so the proxy connects where binference looked and a name cannot rebind
  between the two lookups; an `https:` one keeps its name, which TLS binds to the host's
  certificate.
- **Errors with a next step.** A 407 is `http.proxy_auth`, any other answer to the tunnel
  `http.proxy_refused` with its status (retryable from 500 up), no connection to the proxy a
  retryable `http.proxy_unreachable`, a reset once the tunnel opened the host's
  `http.unreachable`. None keeps its cause, which may name the proxy, a body that breaks as it
  streams included.
- **Never shown.** The proxy URL stays a `Secret` until undici gets it. No log field, error,
  journal entry, notice, check output or support bundle holds it; the bundle shows the source's
  kind and writes each `noProxy` host as `[host]`.
- **Live.** `network` moves to the keys read on use in decision 0230's table: a reload reads the
  proxy again, and each request and socket that starts after it goes by the new route, the
  runtime's from its next settings line; a request under way finishes as it began, and the old
  route's pools close once their requests end. A WebSocket opened by the old route is closed, so
  its owner opens it again by the new one: a chain's block subscription never keeps a route the
  owner left. The reload then sends one request to Telegram through the new proxy, and
  `notice.configChanged` says when it is held, or failed that first use, with `binference check`
  as the next step.
- **Before the engine runs.** `binference init --proxy` takes the proxy as a secret source alone,
  so its address stays out of the shell's history and the process list; `BINFERENCE_INIT_PROXY`
  and the answers file's `proxy` key also take a URL with no password, which init keeps where it
  keeps typed secrets, in decision 0223's order. Init's model and bot token checks go through it,
  and init writes `network.proxy`. Attach, rebuild and backup restore read `network.proxy` from
  the config when one exists and take `--proxy` otherwise. No interactive question asks for it.
- **Checked.** `binference check` gets `network.proxy`: it asks the proxy to reach
  `https://api.telegram.org/` within 10 seconds and names the problem, never the proxy; a proxy
  that never answers before any tunnel opens is unreachable, no answer through an open tunnel a
  warning. `network.cleartext` warns of `http:` RPC addresses the proxy carries, whose answers it
  could change, and of an `http:` proxy with a password on another machine.

## Consequences

- An owner behind a proxy sets one secret source and every part follows it, without a restart.
- A typo in the proxy stops outbound traffic rather than sending it directly; `binference check`
  and the log say why.
- A name on the owner's network that resolves to a private address goes through the proxy unless
  `noProxy` lists it; an IP address does not.
- A proxy that allows `CONNECT` only to port 443 refuses `http:` hosts, since every request is a
  tunnel.
- SOCKS proxies are out of scope, though undici supports them; adding them changes `isProxyUrl`
  and spec 2.
- An `https:` proxy whose certificate a private CA signed is out of scope: binference adds no CA
  for the connection to the proxy.
- Decision 0230's table lists `network` as read on use, and spec 2 marks both keys live.

## Alternatives

- **undici's `EnvHttpProxyAgent`, or Node's own proxy support from the environment.** Neither takes
  address blocks, both read the process's environment rather than config, and neither could hold
  requests when the proxy cannot be read. Rejected.
- **Fall back to direct requests when the proxy cannot be read.** It would send traffic the owner
  meant to hide around the proxy, and fail anyway where the direct path is closed. Rejected.
- **Keep Privy off the proxy.** Where Privy is unreachable directly, custody would stay locked;
  the proxy learns no more than the host name. Rejected.
- **Send private addresses through the proxy too.** A proxy on another machine cannot reach this
  owner's LAN, so a local RPC would fail. Rejected.
- **A restart to apply.** Every request already picks its pool when it starts, so applying at the
  next request costs nothing. Rejected.
