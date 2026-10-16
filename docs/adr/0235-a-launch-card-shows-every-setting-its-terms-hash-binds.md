# 0235. A launch card shows every setting its terms hash binds

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Spec 1](../specs/protocol.md#section-8-1) section 8.1 gives a `launchToken` its launchpad's own
settings as `venueOptions`, "validated by its plugin". [Spec 4](../specs/cards-and-messages.md#section-3-3)
section 3.3 gives a launch one action line, and section 3.6 says a launch refused in paper mode
shows "its card's lines, every setting included". Several cases are left open:

- How a launchpad declares its settings, how the engine checks a request's values, and how a card
  names each setting in both languages, when the settings differ per launchpad.
- Which lines a launch card shows, and what binds them to what is signed.
- What the venue host checks of a launchpad's create call, which makes a token that does not exist
  yet.
- Whether a tap on a launch card waits for a new quote, as a trade's does after 10 seconds.

## Decision

- **A declared schema.** A launchpad's launcher declares each setting it takes: a camelCase name,
  a type (`bps`, `count`, `flag`, `choice` or `account`), its bounds or its words, and its default.
  The engine makes a schema from the declaration and checks a request's `venueOptions` against it
  when the launch is proposed: a name the launchpad does not declare, a value outside its type or
  bounds, or a setting with no default left out is `protocol.bad_args`, and nothing is stored. An
  account is kept in its canonical form on the launch's chain. The launch keeps every declared
  setting, with its default filled in.
- **One message per setting name.** A setting's card line is the message `launch.option.<name>`,
  which takes its value as its type shows it: a share as a percent, a flag as a `select` on `yes`,
  an account as an address. Names mean one thing on every launchpad: a launchpad that declares
  `taxBps` uses the line every launchpad does. The engine refuses to host a launchpad whose setting
  has no such message in every language, or whose default does not fit its setting
  (`venue.bad_declaration`). The catalog ships `taxBps`, `taxRecipient` and `buyback`; a venue task
  adds the names its launchpad needs, in both languages, in the same change.
- **The card's lines.** Under the action line, a launch card shows the token its create call makes,
  the least the first buy gets, the launch fee, the description, each link, the picture (its format,
  its size, the first 16 digits of its SHA-256 and the metadata address), each launchpad setting,
  and that the picture and words are public already. A card cuts a description at 1,000
  characters, a link and the metadata address at 200.
- **The terms hash binds what the card shows.** A launch keeps its request, which holds the name,
  symbol, description, links, pair, first buy and the upload id, and its own quote, which holds
  every resolved setting, the token, the fee, the first buy's expected output and minimum, the
  picture's type, size and full SHA-256, the metadata address and the pin's handle. The card is
  drawn from these two alone, and the card's terms hash covers the request, the quote and the plan
  ([decision 0144](0144-the-terms-hash-covers-the-plan-and-a-re-quote-hashes-again.md)), so every
  line of the card, and the bytes of every step, are bound by the hash the owner's tap confirms.
- **The create call's checks.** The plan is at most one exact approval of the first buy's spend,
  to a registry contract of the launchpad, then one create call to one of its registry contracts.
  The launchpad's decoder reads the create call, and the host refuses it (`decode_mismatch`)
  unless it makes the token the build named, on the pair's chain, with the request's name, symbol
  and pair, the uploaded metadata address and the quoted fee, buys exactly the first buy for the
  launch wallet at no less than its minimum, and carries as value exactly the fee and a first buy
  in the chain's coin. The minimum is the launchpad's quoted output less the agent's maximum
  slippage for a token no registry lists.
- **No re-quote at the tap.** A launch's quote terms hold no minimum out for the stale-quote rule,
  so a tap on a launch card never waits for a new quote: the first buy is the token's first trade,
  its minimum binds it on chain, and a fee the launchpad raised in the meantime makes the create
  call revert rather than pay more.

## Consequences

- Every launch setting the owner confirms is on the card in both languages, and changing any of
  them changes the terms hash.
- A launchpad's plugin cannot run code to check its settings: settings that need more than a type
  and bounds, such as a list of addresses, need a new setting type here first.
- A launch card is longer than a trade's; Telegram's message limit still holds it with a
  1,000-character description.
- The paper refusal of section 3.6 can be drawn from the request and the declared defaults; the
  surfaces that show a refused launch's lines are not built yet.
- Spec 4 section 3.3 gains the launch lines and `launch.option.<name>`.

## Alternatives

- **A check function per launchpad.** Reviewed plugin code could check anything, but the engine
  could not tell which settings a card must show or how. Rejected.
- **Labels in the plugin, in both languages.** The labels would bypass the catalog's checks and
  the glossary. Rejected.
- **Show only the action line and a details link.** The owner would confirm settings the card does
  not show. Rejected.
- **Re-quote a launch at the tap like a trade.** A launch has no market to move before its first
  trade, and a second upload or build at the tap would change the plan the card showed. Rejected.
