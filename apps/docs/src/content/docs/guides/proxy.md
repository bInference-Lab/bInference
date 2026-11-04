---
title: Use an outbound proxy
description: Send every outbound request of binference through your HTTP or HTTPS proxy, choose what goes direct, and check it.
---

When your network reaches the internet only through a proxy, name it in `network.proxy`. Every
outbound request and WebSocket of the engine and the agent goes through it as a tunnel: Telegram,
the model provider, Privy, the RPC nodes and relays, the market, risk and bridge APIs, browser push
and the plugins' requests. binference never sends one of them around a proxy it cannot use.

## Set the proxy

The proxy is an `http://` or `https://` URL, with its user name and password when it needs them,
such as `http://user:password@proxy.example.net:3128`. Since it may hold a password, config takes it
as a secret source, never as plain text:

```json5
network: {
  proxy: { fromKeychain: "binference-proxy" },
}
```

`fromKeychain`, `fromFile`, `fromCommand` and `fromEnv` all work. The background service that
`binference start` installs does not get your shell's variables, so prefer the keychain or a file
for an engine that runs as the service.

At setup, `binference init --proxy` takes the same secret source, sends init's own checks through
it, and writes it to `config.json5`. A URL typed on the command line is refused, so the address
stays out of your shell's history; a URL without a password may come from `BINFERENCE_INIT_PROXY` or
the answers file's `proxy` key.

SOCKS proxies are not supported, and config has no setting for a private certificate authority.

## What goes direct

Requests to this machine (`localhost` and loopback addresses) and to addresses off the internet
(private, link-local and carrier ranges) always go direct. `network.noProxy` lists more hosts that
go direct, at most 256:

```json5
network: {
  proxy: { fromFile: "~/.binference/secrets/proxy" },
  noProxy: ["127.0.0.1", "localhost", "internal.example", "rpc.example.net:8545"],
}
```

Each entry is `*` for every host, a name in punycode that also covers the names under it, an IP
address or `[IPv6]` address, each with an optional `:port`, or an address block such as
`10.0.0.0/8`. binference matches names as written and never resolves them to decide.

## When the proxy fails

- While config names a proxy that cannot be read, or one that is not an `http://` or `https://` URL,
  every request it would carry waits, and none goes direct.
- A proxy that refuses the password, refuses the connection or cannot be reached fails the request
  with `http.proxy_auth`, `http.proxy_refused` or `http.proxy_unreachable`.
- The proxy's address never appears in logs, errors, notices, `binference check` or the support
  bundle.

## Change it while binference runs

binference reads `network` on each request, so a change to `config.json5` applies at once: new
requests take the new route, and open WebSockets close and open again through it. The
[`configChanged`](/reference/notices/#configchanged) notice says whether the new proxy answered.

## Check it

`binference check` tries the proxy as `network.proxy`: it reaches Telegram through it within 10
seconds, or names why not. The `network.cleartext` row warns about an `http://` proxy with a
password on another machine, which sends that password unencrypted, and about `http://` RPC nodes,
whose answers the proxy could read and change.

## Updates

`binference update` gives npm the proxy too. While the proxy cannot be read, it stops with
`update.proxy_held` and changes nothing.

## See also

- [Config keys](/reference/config/) for `network.proxy` and `network.noProxy`.
- [Commands](/reference/commands/) for `init --proxy` and `check`.
