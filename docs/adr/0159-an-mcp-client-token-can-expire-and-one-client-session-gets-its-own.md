# 0159. An MCP client token can expire, and one client session gets its own token

Status: Amended by 0165

Accepted by the owner on 2026-10-11.

## Context

[Decision 0154](0154-the-cli-makes-a-client-token-and-the-engine-keeps-only-its-hash.md) gives
each MCP client one token, made by `binference mcp setup`, that works until the owner revokes it.
The token holds `read` and `propose` only, but a token that never ends keeps working after the
owner has stopped using the client, and a copy of `auth/mcp-<client>.token` keeps working with it.
An owner who wants binference's tools in one Claude Code session has no way to give them for that
session alone.

Claude Code's CLI reference documents `--mcp-config <file>`, which loads MCP servers from a JSON
file, and `--strict-mcp-config`, which uses only those servers. Codex documents no flag that loads
an MCP config from a file or uses only given servers; it documents `-c key=value`, which overrides
one config key for one run, and `mcp_servers.<id>.env_vars`, which names variables of its own
environment that a stdio server gets. A program's arguments are visible to every user of the
machine; its environment is visible to its own user only.

## Decision

- **A token can expire.** `token/register` takes an optional `expiresAt`, in epoch milliseconds,
  after the engine's time and at most 90 days later; another value is `protocol.bad_args`. The
  `tokens` table gains `expires_at`, and `token/list` shows `expiresAt`. A sign-in with a token at
  or past its expiry fails with `auth.expired`, and a connection signed in with it ends with
  `bye auth.expired` when the expiry comes. A token without `expiresAt` works until it is revoked,
  as before.
- **`binference mcp setup --client <client> --ttl <duration>`** makes the client a new token that
  expires after the duration: a whole number of minutes, hours or days (`30m`, `1h`, `7d`), at
  least 1 minute and at most 90 days. Without `--ttl` the token has no expiry, and a kept token
  that has one is replaced by one without.
- **Revoking a client token ends its open connections** with `bye auth.revoked`, as revoking a
  device does.
- **`binference mcp session --client <client> [--ttl <duration>] [-- <client args>]`** starts
  the client for one session with a token of its own:
  1. The CLI makes the secret, as setup does, and registers its SHA-256 with the label
     `mcp-<client>-session` and an expiry: 1 hour by default, at most 24 hours. Setup and session
     tokens never revoke each other.
  2. It starts the client with the secret in `BINFERENCE_MCP_TOKEN` in the client's environment,
     never in its arguments or in a file. `binference mcp` signs in with that variable when it is
     set, else with the client's token file. `BINFERENCE_MCP_TOKEN` is not a config key.
  3. Claude Code gets `--strict-mcp-config --mcp-config <file>`, where the file is written
     owner-only in the state folder's `tmp/` and holds one `binference` server and no secret; the
     server gets the variable from Claude Code's environment. Codex gets `-c` overrides of
     `mcp_servers.binference` (its command, arguments, `BINFERENCE_HOME` and
     `env_vars = ["BINFERENCE_MCP_TOKEN"]`); its other MCP servers stay, as Codex has no documented
     way to leave them out.
  4. When the client exits, the CLI revokes the token and removes the file. A `SIGTERM` to the CLI
     is passed to the client first. A `SIGINT` is left to the client, which gets its own from the
     terminal. A fault in the CLI revokes the token on its way out. When the CLI is killed, the
     expiry ends the token.
  5. `--print-config` registers the token, prints the client's config, the variable to set and
     the expiry, starts nothing and revokes nothing: the token works until its expiry.

## Consequences

- An owner can give a client binference's tools for one session, and a forgotten setup can end by
  itself.
- A session's secret lives in the client's process environment, which the client's own tools,
  such as a shell, can read. It holds `read` and `propose` only, as every MCP token does, and ends
  with the session or its expiry.
- `--print-config` writes the secret to the terminal once, as the owner must set it by hand.
- A Codex session still loads the owner's other MCP servers.
- `engine.sqlite` gains a column, and the protocol gains an optional field in each direction.

## Alternatives

- **The secret in the config file or in the client's arguments.** Any reader of the file, or any
  user listing the machine's processes, would see it. Rejected.
- **A temporary `CODEX_HOME` with only binference's server.** Codex keeps its sign-in in
  `CODEX_HOME`, so the session would start signed out. Rejected.
- **Revoking on `SIGINT`.** A press of Ctrl+C in the client reaches the CLI too, and would end the
  session's tools while the client runs on. Rejected.
- **Expiry enforced by the CLI alone.** A copied token file would outlive it. Rejected.
- **No maximum.** A typing slip such as `7000d` would make a token that outlives the owner's
  interest in it. 90 days for setup and 24 hours for a session bound it.
