# 0190. A buy order spends a named asset by amount or by share

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Decision 0189](../DECISIONS.md#d0189) let a buy order take its size in dollars only and kept
`{ base }` and `{ percentBps }` refused for buys "until a decision says what they spend". A buy
intent names what it spends (`spend`, the chain's coin or a registry token,
[spec 1](../specs/protocol.md) section 8.1), but an auto order request has no such field, so an
amount in base units or a share of a balance has no asset to count. Trades never spend the last of
the chain's coin that pays network fees ([decision 0045](../DECISIONS.md#d0045)); a share of the
whole coin balance would reach into that reserve.

## Decision

- **What a buy spends.** An auto order request gains `spend?: AssetRef`: the chain's coin or a token
  the registry lists on the token's chain, never the token it buys. Absent, the chain's coin;
  `order/create` fills it in, so the card's terms hash binds it. A sell order naming `spend` is
  `protocol.bad_args`.
- **The sizes of a buy.** `{ usdMicros }` spends that many dollars of the asset, priced at the
  fill, as before. `{ base }` spends that amount in the asset's base units. `{ percentBps }` spends
  that share, rounded down, of the wallet's spendable balance of the asset when the fill is quoted:
  the whole balance of a token, and of the chain's coin what lies above the agent's gas reserve,
  never below zero. A share is above 0 and at most 100%; an amount above 0.
- **The caps hold.** Each fill is a `buy` intent that runs policy and risk again, so the per-trade
  cap, the rolling 24-hour cap and the gas reserve judge every fill at its own value, whatever the
  size.
- **The card** says what the buy spends (`card.order.spend`): a dollar value of the asset, an
  amount of it, or a share of what the wallet may spend of it. An order stored before this decision
  names no asset and shows its dollar value alone.

This amends decision 0189.

## Consequences

- Spec 1 section 8.2 gains `spend` and the meaning of each buy size; spec 6 section 5 the buy sizes
  and invariant 15 (a share never spends more than the spendable balance, nor the reserve); spec 4
  section 3.8 the line `card.order.spend`.
- The order store keeps `spend` inside the stored request, so no column changes.
- The fill step, still to come, reads the balance and applies the size; the share's rounding and
  the reserve live in one function with a property test, which it will call.

## Alternatives

- **Always spend the chain's coin.** A stablecoin buy, the common way to set a dollar budget,
  would be impossible. Rejected.
- **A share of the whole balance, reserve included.** The fill would fail policy on
  `gas_reserve` each time at 100%, and near it. Rejected.
- **A share of the balance when the order is confirmed.** The amount would not follow the wallet
  between the tap and a fill weeks later, so a fill could spend money the owner moved since.
  Rejected.
