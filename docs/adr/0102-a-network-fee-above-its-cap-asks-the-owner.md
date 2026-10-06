# 0102. A network fee above its cap asks the owner

Status: Accepted

## Context

The fee per gas of each transaction comes from an RPC node, and nothing checked it: no config key,
no hard rule in the signer, nothing in the ceiling (spec 5). A wrong or hostile answer could make
every transaction overpay gas. On 2026-10-06 the fee per gas on BNB Smart Chain was 0.05 gwei, the
network floor that [ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28) names.
[Decision 0088](../DECISIONS.md#d0088) says anything over a cap always needs a tap.

## Decision

Each chain has a network fee cap: the most fee per gas a transaction pays without the owner's tap.
It is the config key `chains.maxFeePerGasGwei.<chain>`, 1 gwei on BNB Smart Chain by default, 20
times the fee per gas of 2026-10-06.

A fee per gas above the cap does not refuse the intent. The intent opens a card that shows the fee
and waits for the tap. Auto mode never runs it.

## Consequences

- `readFees` returns the fees with whether they are above the cap, instead of refusing them.
- The auto test reads the intent's fee per gas and the cap, and refuses auto above the cap with its
  own code, `overFeeCap`; the card says why. A property test checks that no fee above the cap ever
  runs in auto mode.
- Spec 2 lists the key, spec 6 the auto test's new condition, and spec 4 the `autoAsks.overFeeCap`
  line. The default lives in the config defaults, never in a pure package.
- The new key raises the config file to version 2. `binference check --fix` moves an older file
  there without changing a value.
- During a fee spike above the cap, every auto trade opens a card until the fee falls.
- The signer's hard rules do not check the fee, since a tap may approve a fee above the cap.

## Alternatives

- **Refuse a fee above the cap.** A spike would stop every trade, a stop-loss sale included, even
  when the owner would pay the fee. Rejected.
- **No cap.** A wrong node answer would overpay gas on every auto trade with nobody asked.
  Rejected.
- **0.1 gwei.** Twice the floor: a small rise of the floor would turn routine auto trades into
  cards. Rejected.
