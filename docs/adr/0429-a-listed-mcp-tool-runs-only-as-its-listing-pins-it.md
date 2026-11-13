# 0429. A listed MCP tool runs only as its listing pins it

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

[Decision 0428](0428-the-cloud-agent-calls-listed-mcp-servers-as-read-tools-that-mark-every-turn.md)
gives a Cloud agent the tools of the MCP servers bInference lists. A server's tool list is its own:
after a review it can rename a tool, widen a schema, write instructions into a description or add
a tool that writes. The arguments the agent sends are the one way the agent's words leave for a
listed server.

Model providers take tool names of at most 64 letters, digits, `_` and `-`.
[Decision 0348](0348-a-community-plugin-installs-from-npm-by-its-integrity-and-provenance-pinned-by-its-files.md)
names a plugin's tool `<id>__<tool>` with the id's hyphens as underscores, so a plugin tool's name
can hold any run of underscores, but never a hyphen; no built-in tool's name holds one either.
[Decision 0343](0343-the-plugin-host-runs-each-community-plugin-as-a-sealed-program-and-probes-every-gap-first.md)
keeps a plugin's schemas to a short list of JSON Schema keywords with no regex of the plugin's own.

## Decision

- **The listing**, as the runtime reads it; the catalog signs and serves it:
  - `listing`, the catalog's id, `mls_` and a UUIDv7, and `version`, a positive integer that rises
    with each reviewed change;
  - `name`, 2 to 16 of `[a-z0-9]` starting with a letter, unique among the listings in force, and
    `title`, 1 to 40 printable characters, escaped as a token's name is;
  - `url`, the server's MCP endpoint: `https:`, a DNS name and not an address, port 443, no user
    name, password or fragment, at most 2,048 characters, passing the URL guard;
  - `revision`, the MCP revision the review tested: `2025-06-18`, `2025-11-25` or `2026-07-28`;
  - `timeoutMs`, 1,000 to 20,000, and `maxBytes`, 4,096 to 1,048,576, its caps
    ([decision 0430](0430-the-mcp-client-reaches-only-its-listing-s-endpoint-within-its-caps.md));
  - `tools`, 1 to 8, each with `server`, its name as the server's `tools/list` gives it, 1 to 128
    of `A-Z a-z 0-9 _ - . /`; `as`, 1 to 40 of `[a-z0-9_]` starting with a letter; `kind`, which is
    `read` and nothing else; `description`, 1 to 1,000 characters, the reviewed words the model
    reads; `input`, the JSON Schema binference checks arguments with and shows the model;
    `output`, the JSON Schema of the tool's `structuredContent`, when it has one; and
    `serverDigest`, the SHA-256, in hex, of the tool's `name`, `inputSchema` and `outputSchema` as
    the review read them from the server, as JSON in the canonical form of RFC 8785.
- **The listing in force** names the agents that have it on, 1 to 64, each once.
- **Budgets.** One listing in force is at most 64 KiB as JSON, and is refused `bounds` past it,
  as one at every tool's maximum would be. All the listings the settings carry are at most 512
  KiB together; the composition root leaves out those past it, in listing id order, with
  `runtime.listing_refused` `bounds`. The settings reach the runtime as one line of at most 1 MiB
  beside the models' and plugins' settings, and a line it cannot read ends the runtime; and every
  listed tool's words and schemas go into each model call of the agent that has it on.
- **The name** the model calls is `mcp-<name>-<as>`, at most 61 characters. A test holds every
  built-in tool's name to `[a-z0-9_]`, and a plugin tool's name is of those characters by decision
  0348, so no other tool takes a name that starts `mcp-`.
- **Names like binference's are refused.** A listing whose `as`, or whose `server` folded to
  lowercase with `-`, `.`, `/` and spaces as `_`, equals a built-in tool's name is refused whole,
  `name_taken`: a server's `swap`, `send` or `quote` never reaches an agent, under any name.
- **Schemas.** `input` and `output` use only the keywords decision 0343 allows a plugin's schemas,
  and `$schema` as a note: no `pattern`, `format`, `patternProperties` or `$ref`, at most 8 levels
  and 16,384 characters. `input` describes an object; every object in it sets
  `additionalProperties: false`, every string sets a `maxLength` of at most 1,000 or is an `enum`
  or a `const`, and every array sets a `maxItems` of at most 100. binference's own code checks both
  with zod from the JSON Schema: the client hands the SDK binference's validator and names each
  call's tool definition from the listing, so the SDK compiles no schema of its own.
- **What the agent may send.** Arguments that pass `input` exactly, with no coercion, at most 8 KiB
  as JSON. Arguments that hold, in any string or in a list's strings read together, a recovery
  phrase (12 or more words of the BIP-39 English list with only spaces, line breaks and list marks
  between them, as the shell's output masking finds one), a PEM private key block, a binference key
  (`binf_`, `bnt_`), a Telegram bot token or an owner key code are `refused` before anything is
  sent. The log redaction's wider phrase pattern stays for logs, since it reads a plain question of
  12 short words as a phrase. A bare 64-hex value passes, since a transaction hash looks the
  same. The client
  adds nothing of the agent's: no agent, wallet, owner, session or language. It names itself
  `binference` with its version, and sends no `authorization` and no cookie.
- **The live list is checked.** At each connection the client reads `tools/list` a page at a time
  by its cursor, at most 4 pages, past any cache hint the server gives; a listed tool not seen in
  them is `missing`. A listed tool whose live digest differs from its
  `serverDigest`, that the list lacks, or whose own annotations say `readOnlyHint: false` or
  `destructiveHint: true`, is off: from then on it answers `tool_off` with `changed`, `missing` or
  `writes`, until the listing's version changes or the runtime starts again. A live tool the listing
  does not name is never offered and never called. A live description is never read, so a server's
  words reach the model only in its answers.
- **Answers.** A tool with `output` answers its `structuredContent`, which must pass `output`, else
  `bad_answer`; one without answers its text blocks, joined by blank lines. An image, audio,
  resource or resource link block is left out with one line naming its type, and no link in an
  answer is opened. An answer with `isError: true` gives the server's text as the tool's error.
  U+0000 becomes U+FFFD ([decision 0416](0416-no-stored-text-holds-u-0000-on-either-database.md)),
  and the result is cut at 12,000 characters as any tool result is.

## Consequences

- What the model reads of a listed tool is what the review read: the listing's name, words and
  schemas. A change on the server turns the tool off instead of reaching the agent.
- A routine change to a server's schema turns its tool off until the listing is reviewed again, so
  the catalog's reviews must follow the servers they list.
- A server whose schemas need `pattern`, `format` or `$ref`, or whose tools take long free text, is
  listed only with a stricter `input` the review writes and the server still accepts.
- The agent's words leave through at most 8 KiB of typed, bounded arguments a call, and 25 calls a
  turn.

## Alternatives

- **Offer the server's live tools.** The words the model reads would not be the words the review
  read.
- **Check arguments with the server's own schema.** Servers often leave objects open and strings
  unbounded. A stricter copy the review writes no longer equals the server's, so the change check
  needs a digest of its own.
- **Name tools `<name>__<tool>`.** A plugin's tool can hold the same name, since plugin ids turn
  hyphens into underscores.
- **Put descriptions and annotations in the digest.** The model never reads a live description,
  and an edit of a server's words alone would turn tools off without a change to what they take or
  answer.
- **Trust `readOnlyHint`.** It is the server's own claim; it can turn a tool off, never on.
