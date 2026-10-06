# 0101. A denied token is sold only with a tap

Status: Accepted

## Context

Each agent's limits hold a token allow list and a deny list (spec 2, `defaults.limits`;
[ARCHITECTURE.md section 11](../ARCHITECTURE.md#section-11)). The policy refused with
`token_denied` any intent that moved a token on the deny list, in or out. A denied token can still
land in an agent's wallet, for example from an airdrop, and the agent could then never sell it.
[Decision 0088](../DECISIONS.md#d0088) lets auto mode run buys, sells and swaps within the caps, and
lists what always needs a tap.

## Decision

An intent may sell, or otherwise move out of the wallet, a token on the deny list that the agent
holds. It passes the policy with a mark that it needs the owner's tap, and it always opens a card,
in auto mode too. Buying or receiving a token on the deny list stays refused with `token_denied`.

The allow list is unchanged: when it is set, a token missing from it is refused in either
direction.

## Consequences

- The policy reads the assets an intent receives apart from those that leave the wallet, so it
  tells a sale from a buy.
- The policy's pass carries the mark `sellsDeniedToken`. The auto test reads it and refuses auto
  with its own code, `deniedToken`, and the card says why. A property test checks that no sale out
  of a denied token ever runs in auto mode, and that no intent that receives one passes the policy.
- Spec 6 says so in its `token_denied` row, its auto test and invariant 8; spec 4 adds the
  `autoAsks.deniedToken` line.
- Decision 0088's list of what always asks gains this case. It keeps its text, with the status
  Amended by 0101.

## Alternatives

- **Refuse every move of a denied token,** as before. A denied airdrop stays in the wallet for good.
  Rejected.
- **Let auto mode sell a denied token.** The deny list is the owner's word on a token, so a trade
  in one is the owner's call. Rejected.
- **Treat a token missing from a set allow list the same way.** Outside this decision: the allow
  list still names the only tokens the agent may touch.
