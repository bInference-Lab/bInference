# 0199. An unlisted token shows by what its contract answers at the proposal

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

A card draws every amount with its token's symbol and decimals (spec 4, section 3), and the card
renderers refuse to draw a token they have no `AssetInfo` for (`engine.card_asset_unknown`). The
engine took those infos from the chain registry alone, so a card for any token the registry does
not list, as most launchpad tokens are, could not be drawn: the owner could not confirm it on
Telegram or in the console. Spec 4 already says how such a token reads, its symbol followed by its
short address, and the risk check already passes such tokens. The specs leave open where its
symbol and decimals come from, when they are read, and what happens when the token does not
answer.

## Decision

- **From the token's own contract, never from the model.** A `swap`, `buy` or `sell` proposal and
  an `order/create` read `symbol()`, `name()` and `decimals()` of each token they name that the
  registry does not list, in one Multicall3 call on the token's chain. A symbol or name may be an
  ABI string or a `bytes32`; zero bytes are dropped, and at most 64 characters of a symbol and 128
  of a name are kept. A name the token does not answer is its symbol.
- **Read once, at the proposal, and stored with the intent.** The engine reads before it stores
  anything, and the new intent keeps the answers in `intents.assets`, each marked
  `verified: false`. Every card version, receipt and intent view of the intent draws the token from
  there; the registry's info wins for a listed token. A re-quote changes no token, so it reads
  nothing.
- **A token that answers no symbol or no decimals is refused.** No card could show its amounts, so
  the proposal fails with `asset.unreadable` and stores nothing. A chain that cannot be read fails
  the call as any other read does.
- **A fill reads nothing.** An order's fill opens no card; it trades the token its order's card
  named.
- **Shown as unverified.** The token's symbol is outside text: cut, escaped and always followed by
  its short address, with the card's warning that the token is not verified (spec 4, section 1).

## Consequences

- Migration 0034 adds `intents.assets`. Spec 1 gains the error `asset.unreadable`; spec 3 gains the
  column.
- Cards and receipts for unlisted tokens draw on Telegram and in the console, in both languages.
- A token that changes its symbol after the proposal keeps the old one on that intent's cards: the
  owner confirms what was shown.
- Notices that name an unlisted token's amount still need its facts, which the order's intent holds.

## Alternatives

- **The name a risk source or market feed reports.** Third parties copy the deployer's text, may
  be down, and differ from each other; the contract is the one source every chain read agrees on.
- **Read at each drawing.** Every Telegram copy, receipt and console view would make a chain call,
  and a card could change under the owner's eyes; one read at the proposal binds what is shown.
- **Draw the amount in base units with the address alone.** Correct but unreadable: an owner
  cannot judge `4781886369282840181` of a token.
- **Store the facts in the quote document.** A re-quote replaces the quote, so every quote writer
  would have to carry them; the intent row keeps them once.
