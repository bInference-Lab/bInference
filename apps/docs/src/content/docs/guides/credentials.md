---
title: Credentials and API calls
description: Store an API key once with the hosts it may go to, and let the agent call the API without ever seeing the key.
---

Some tasks need an API key, such as a data service's. You store it in binference as a credential.
The agent then calls the API with `http_request` and writes a stand-in where the key goes, and
binference puts the key in only for the hosts you allowed. The key never reaches the agent, the
chat, the transcript or the logs.

## Store a credential

A credential has a name written as an environment variable's, such as `DUNE_API_KEY`, a value, and
the hosts it may be sent to:

```sh
binference credential set DUNE_API_KEY --allow-host api.dune.com
```

You type the value at a masked prompt; no flag takes it. Repeat `--allow-host` for each host, up
to 16. A host is matched exactly: `api.dune.com` covers neither `eu.api.dune.com` nor `dune.com`.
Storing a name again replaces its value and its hosts, so name every host each time. The agent
never sends a credential stored with no host.

`binference credential list` shows each name with its hosts, never a value.
`binference credential delete <name>` removes one: no read finds it from then on, and its value is
purged 30 days later. Values stay in `engine.sqlite`, a file only your user reads, and backups are
sealed to your owner key.

## When the agent asks

When a task needs a credential you have not stored, the agent asks for it with its name, a reason
and the hosts it proposes. Its turn ends while the request waits, and your answer starts its next
turn: the agent hears what arrived, never the value.

- In the console, a masked prompt shows above the message box, with the hosts you can edit. Store
  saves the credential; Skip declines.
- In the terminal chat, type the value under the request, where it shows as dots. Enter stores it
  for the hosts the agent proposed; Esc skips. A paste of more than one line is refused whole.
- In Telegram, the bot says where to answer. Never send a credential in a Telegram chat: a message
  there reaches the agent.
- In a shell, `binference credential set <name> --allow-host <host>` answers it too.

A request stays open 15 minutes, or the time the agent names, from 30 seconds to an hour. An agent
has one open request at a time.

## Calls with a credential

`http_request` makes one HTTPS request: `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`, with up
to 32 headers and a text body. Where a key goes, the agent writes `{{credential:NAME}}`:

- in a header's value, such as `Authorization: Bearer {{credential:DUNE_API_KEY}}`
- in the URL's query, such as `?api_key={{credential:DUNE_API_KEY}}`
- in the body

binference sends the request only when every rule holds, and sends nothing otherwise:

- The URL is `https:` at a public address: never this machine, a private network, or binference's
  own address in `remote.publicUrl`.
- Each stand-in names a stored credential whose hosts list the URL's host, on the default port 443.
- A stand-in sits only in a header's value, the query or the body, never in the host or the path.
- In a chat that read outside content, a request with a credential may only `GET` or `HEAD`, so a
  page cannot make the agent post, order or delete on your account. Send `/clear` and ask again.

Redirects are never followed: the agent gets the new location and calls it again, judged on its
own. A call has 1 to 25 seconds, 20 by default. The agent reads the status, a few headers such as
the content type and the rate limits, and up to 10,000 characters of the body; an answer over
8 MiB is not read. Before the agent reads anything, binference writes the stand-in again wherever
the answer repeats a value the request carried, as it is or percent-encoded. Everything the site
answered is outside content.

The log keeps one line per request: the method, the host, the status and the time it took, never
the path, the query, a header or the body.

## What it cannot do

- A key the API repeats in another form, such as base64, is not masked.
- An API that takes its key in the URL's path, or in Basic authentication built from a user name
  and a password, cannot be called with a stand-in.
- An API that takes longer than 25 seconds to answer cannot be called.
- Helpers never get `http_request`, and the agent's commands never get a credential.

Without a stand-in, `http_request` reaches any public HTTPS address, as the agent's shell already
can.

## A credential in the config

A config key that takes a secret source can name a stored credential, so one stored copy serves the
agent and the config:

```sh
binference config set search.keys.brave --from-credential BRAVE_KEY
```

This writes `{ fromCredential: "BRAVE_KEY" }`. Only the running engine reads it, and it goes
wherever that config key sends it, whatever hosts the credential lists. The agent key and the Privy
app secret never come from a credential. Deleting a credential a config key names leaves that key
without a value from the next start.

## See also

- [Commands](/reference/commands/) for `credential` and `config set`.
- [Config keys](/reference/config/) for the keys that take a secret source.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for `credentials` and `http_request`.
