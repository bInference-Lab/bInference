# 0154. The CLI makes a client token, and the engine keeps only its hash

Status: Amended by 0159

Accepted by the owner on 2026-10-11.

## Context

`binference mcp setup` gives an MCP client, such as Claude Code or Codex, a token with the `read`
and `propose` scopes ([protocol spec, section 4.2](../specs/protocol.md#section-4-2)). The spec
names `token/create`, a write that answers the new `bnt_` secret. Every write's result is kept in
the idempotency store for 24 hours (section 5), so the secret would sit in `engine.sqlite` beside
the SHA-256 the access store keeps instead of it. The server's rule is that a secret never reaches
a stored row, and the engine serves no token operation yet.

## Decision

- **The CLI makes the secret.** It draws 32 random bytes, writes `bnt_<base64url>` owner-only to
  `auth/mcp-<client>.token` in the state folder, and sends only its SHA-256 to the engine.
- **`token/register` stores the hash.** A new operation, `admin`, write, IPC only:
  `{ label, kind, scopes, secretHash }` → the token as `token/list` shows it. `kind` is `mcp` or
  `custom`. A hash the store holds is `protocol.bad_args`. The idempotency store keeps the view,
  which holds no secret.
- **`token/list` and `token/revoke` are served** as section 7.9 names them.
- **`token/create` stays unserved in v1,** as `wallet/exportKey` does.
- **One token per client.** `binference mcp --client <client>` signs in with that client's file,
  so removing one client revokes its token and leaves the other's.
- **The client's config holds no secret.** Its MCP entry runs `binference mcp --client <client>`;
  the token stays in the state folder.

## Consequences

- No secret reaches the idempotency store, a log or a client's config file.
- A token file and its hash can part, such as after a restore: setup signs in with the file to
  check it, and makes a new token when the engine refuses it.
- Setup needs a running engine and the CLI token, as every other admin command does.

## Alternatives

- **Serve `token/create` and leave its result in the idempotency store.** The secret would stay
  in the database for 24 hours. Rejected.
- **Serve `token/create` without storing its result.** A retry with the same key could not answer
  the first result, which section 5 promises. Rejected.
- **Write the token into the client's MCP config.** Every tool that reads that file, and every
  backup of it, would hold the secret. Rejected.
