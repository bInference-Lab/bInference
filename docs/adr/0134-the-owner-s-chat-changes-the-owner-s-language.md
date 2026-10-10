# 0134. The owner's chat changes the owner's language

Status: Accepted

## Context

[Spec 4, section 5](../specs/cards-and-messages.md#section-5) gives `/lang` a button for each
language. The owner's language is `owner.locale` in config.json5
([spec 2](../specs/config.md)), which the engine reloads and applies at once
([decision 0118](../DECISIONS.md#d0118)). Settings change through `config/change`, which needs the
`admin` scope ([spec 1, section 7.9](../specs/protocol.md#section-7-9)), and the owner's Telegram
chat holds only `read` and `confirm`: settings and loosening need the CLI, the console or the Mini
App ([rule 11](../ARCHITECTURE.md#rule-11)). The language is no safety setting: it changes no
limit, key, address or mode. The owner decided on 2026-10-10.

## Decision

- A `/lang` button sets `owner.locale`, and only it, through `config/change`, as a narrow
  exception to its `admin` scope. The engine runs a call from the owner's chat whose patch is
  exactly `{ owner: { locale } }`, with `en` or `zh`, and answers any other patch from the chat
  with `auth.scope`.
- The change writes config.json5 in place and keeps every other byte, comments included. A file
  the edit cannot read, or one the edit would change in any other way, is `config.invalid`, and
  nothing is written.
- The live reload journals the change, announces it with `notice.configChanged` on every surface
  and applies it at once, like any change of the file (decision 0118).
- Every other caller still needs `admin` for `config/change`.

## Consequences

- The owner switches binference's language from the chat, with no shell on the machine. A
  hijacked Telegram account can switch it too, which changes how binference speaks and nothing
  it does.
- A layer above the file, a `BINFERENCE_OWNER__LOCALE` variable or a `--set owner.locale` flag,
  keeps its value ([spec 2, section 3](../specs/config.md#section-3)): the file changes and the
  language stays.
- Until the config writer serves every key, the composition root gives `config/change` to the
  owner's bot alone, for `owner.locale`; the protocol server does not serve it yet.
- Spec 1 notes the exception at `config/change`, and spec 4 says what the buttons do and the
  callback data they carry.

## Alternatives

- **Point `/lang` at config.json5.** The owner edits a file on the machine to switch the
  language of a chat. Rejected.
- **A language the bot keeps for itself.** `owner.locale` is the language of every surface; a
  second setting would let the surfaces differ. Rejected.
- **The `admin` scope for the chat.** Every setting would open to a chat message. Rejected.
