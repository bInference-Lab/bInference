# 0263. binference report writes a redacted support bundle in the CLI

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

ARCHITECTURE.md section 24 lists `binference report`, "a redacted support bundle", and the protocol
spec lists `report/create` (`admin`, a job that ends with a file). Neither says what the bundle
holds, how it is redacted, or where it is made. An owner asks for help most often when the engine
does not start, so a bundle the engine makes would be missing exactly then. The bundle leaves the
machine: anything in it may reach a stranger. The install holds secrets of many kinds (the agent
key, the Privy app secret, the bot token, model, RPC, venue and search keys, a proxy URL with its
password, the CLI and MCP tokens, the browser push key), the owner's saved addresses and their
labels, wallet addresses, and the agent's chats and notes. The engine log already writes one JSON
line per record with a strict set of id fields; the service's own output (`logs/service.log`) is
free text.

## Decision

- `binference report` builds the bundle in the CLI, with the engine running or stopped, and before
  `init`. It writes one JSON file, owner-only, to `reports/report-<UTC time>.json` in the state
  folder and names it; the owner can read every line before sharing it. `--json` prints `{ file }`.
- It holds: the versions of binference, Node, the OS and its release, and the CPU type; the config
  as `config/read` shows it, each secret source as its kind only (`fromFile`, never its path);
  every finding of `binference check` by its check id; the engine's `engine/status` if it answers
  within 5 seconds, else why not; the newest engine log lines (at most 2,000 from the last 2 MiB)
  and the size of `logs/service.log`.
- It never opens a key, a database, the keychain, a chat or a saved address. What it reads passes
  rules that keep, never rules that remove:
  - An engine log line is kept only when it parses as the log's JSON shape; any other line is
    counted as omitted. Of a kept line, only the fields the shape names pass, each by its own
    rule: ids, chain ids, source ids and error codes when they have their shape; accounts and
    assets with their address cut to `0x1234…abcd`; numbers. A value that breaks its rule stays
    as `[omitted]`.
  - `logs/service.log` is free text, so only its size goes in.
  - In the config, the check findings and the status, a URL keeps only its kind, by the config
    keys above it: `[url:rpc]`, `[url:relay]`, `[url:public_address]`, `[url:model_provider]` or
    `[url:webhook]`, else `[url]`. No host, path, query or credential stays, so the owner's own
    host names never leave (the owner's choice, 2026-10-20). A local path becomes `[path]`, and
    every other string passes a last filter: the secret patterns of the log redaction, addresses
    cut short, any other URL replaced by `[url]`, any other run of 24 or more key-like characters
    masked unless it is a binference id, and the home folder written as `~`.
- `report/create` stays unserved in v1. A surface other than the terminal that needs a bundle gets
  its own decision.

## Consequences

- A bundle exists when the engine is down, and no setting, log line or future field can put a
  secret, a saved address's label or chat text in it unless a field rule is widened on purpose.
- Support sees no free-text error output; a crash at start shows as the engine log's error codes
  and the service log's size, and the owner shares `logs/service.log` by hand if asked.
- The platform reads the machine's Node version, OS, OS release and CPU type, and the CLI host
  carries them.
- Support cannot tell which RPC or model provider an install uses from the bundle; it asks the
  owner.
- The protocol spec's `report/create` row says it is unserved.

## Alternatives

- **The engine makes the bundle as a `report/create` job.** No bundle when the engine cannot start,
  the time it is needed most. Rejected for v1.
- **Raw logs with secrets masked by patterns.** A pattern list misses what it does not know, such
  as a label or a sentence of chat. Rejected for the engine log, whose shape allows field rules.
- **Keep each URL's origin.** It would name the owner's private RPC hosts and the address where
  the engine is published. Rejected by the owner.
- **A compressed archive of several files.** The owner could not read it before sharing it, and
  one JSON file of this size needs no compression. Rejected.
