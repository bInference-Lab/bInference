# 0165. Only binference's server gets a Claude Code session's MCP secret

Status: Accepted

Accepted by the owner on 2026-10-11.

Amends [decision 0159](0159-an-mcp-client-token-can-expire-and-one-client-session-gets-its-own.md).

## Context

[Decision 0159](0159-an-mcp-client-token-can-expire-and-one-client-session-gets-its-own.md)
starts the client of a `binference mcp session` with the session's secret in
`BINFERENCE_MCP_TOKEN` in the client's environment. Every program the client starts inherits that
environment: the shell its tools run commands in, its hooks, its other MCP servers. A command a
prompt injection gets the client to run can print the secret with `env`. The secret holds `read`
and `propose` only and ends with the session, but nothing past binference's own server needs it.

Claude Code's MCP documentation gives each stdio server in a config file its own `env`, set in that
server's environment. A session already writes such a file, owner-only in the state folder's
`tmp/`, and removes it when the session ends.

OpenAI's Codex config reference gives `mcp_servers.<id>.env` for literal values, but Codex reads
config only from its files in `CODEX_HOME` (which [decision 0159](0159-an-mcp-client-token-can-expire-and-one-client-session-gets-its-own.md)
leaves alone, as it holds the owner's sign-in), from a trusted project's `.codex/config.toml`, or
from `-c` overrides in its arguments, which every user of the machine can list. It documents
`shell_environment_policy.filters`, case-insensitive filters by variable name whose `exclude`
nothing can put back, for the commands its shell tool runs.

## Decision

- **Claude Code: the secret in the server's entry alone.** The session's `--mcp-config` file gives
  the `binference` server `env.BINFERENCE_MCP_TOKEN` with the secret, beside `BINFERENCE_HOME` when
  set. Claude Code's own environment does not get the variable. The file stays owner-only in
  `tmp/` and is removed when the session ends, as before.
- **Codex: the secret stays in its environment**, as Codex can take a literal value no other way
  without the secret in its arguments or in a file of the owner's project or `CODEX_HOME`. The
  session adds `-c shell_environment_policy.filters.BINFERENCE_MCP_TOKEN="exclude"`, so the
  commands Codex's shell tool runs do not get it; `env_vars` still passes it to the `binference`
  server.
- **An outer variable never passes.** A `BINFERENCE_MCP_TOKEN` in the CLI's own environment, in
  any letter case, is left out of the client's.
- **`--print-config` is unchanged:** it prints a config without the secret and the variable for the
  owner to set, as the owner starts that client by hand.

Decision 0159 stays as written for everything else.

## Consequences

- In a Claude Code session, the secret is in binference's server process and the session's config
  file, not in the environment of Claude Code, its shell commands, its hooks or its other servers.
- A program running as the owner that finds the config file in `tmp/` while the session runs can
  still read it, as it could read the environment of a process it starts; the session's limits
  bound that case, as before.
- In a Codex session, the secret is in Codex's process environment and its `binference` server, and
  out of its shell commands; a hook or another program Codex starts outside its shell tool may
  still inherit it.

## Alternatives

- **The secret in a one-shot file the server deletes after reading it.** Claude Code would start
  the server again after a dropped connection, and the second start would find no secret. Rejected.
- **The secret in a `-c` override for Codex.** Every user of the machine can list a process's
  arguments. Rejected.
- **A `.codex/config.toml` in the folder the session starts in.** It writes a secret into the
  owner's project, and Codex reads it only from a project the owner trusts. Rejected.
- **A temporary `CODEX_HOME`.** Codex keeps its sign-in there, as decision 0159 found. Rejected.
