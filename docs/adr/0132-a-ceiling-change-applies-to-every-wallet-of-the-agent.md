# 0132. A ceiling change applies to every wallet of the agent

Status: Accepted

## Context

[Spec 5, section 4](../specs/keys-and-backups.md#section-4) says raising the ceiling or adding a
venue's contracts to it is an owner-key action: `binference ceiling set`. The protocol's
`ceiling/set` takes `{ wallet, changes: { chains?, venues?, perTxNative? }, ownerKey }`. An agent
may hold more than one wallet ([decision 0130](../DECISIONS.md#d0130)), each under a ceiling of its
own, and `limit/set` refuses a venue a live wallet's stored copy of its ceiling leaves out
([decision 0111](../DECISIONS.md#d0111)). Privy's rules are written over in place: a ceiling's
chains come with the wallet when it is made. Nothing said which wallets a change reaches, what a
change of chains does, or what happens to a venue the limits still name. The owner decided on
2026-10-10.

## Decision

- `ceiling/set` needs the owner key over IPC and changes the ceiling of every live wallet of the
  named wallet's agent.
- It changes the venues whose registry contracts a contract call may reach and approve, and the
  most native coin one call may carry, on the chains each ceiling already enables. Other `chains`
  are `protocol.bad_args`: a new chain needs a new wallet. The chains a ceiling enables already
  are taken.
- No venue, or a venue the registry lacks, is `protocol.bad_args`. Removing a venue the agent's
  limits name, in effect or waiting, is `limit.venue_in_use`, a new error code.
- Each wallet's stored copy of its ceiling is read back from custody after the change, so
  `limit/set` checks against what custody holds.
- A change that moved a ceiling is journaled at `agents.<name>.ceiling`, pushed as
  `config/changed`, and announced on every surface as `notice.ceilingChange`, in English and
  Chinese, naming what moved.
- `binference ceiling set` takes `--venues` and `--per-tx`, the cap in the native coin as
  `defaults.ceiling.perTxBnb` writes it.

## Consequences

- The agent's wallets keep one set of venues and one cap, so a trade allowed on one wallet is not
  refused on another.
- Privy's rules are written one ceiling at a time; a refusal part way leaves earlier ceilings
  changed, and every stored copy is read back either way.
- The install store gains `updateCeiling`, and custody's ceiling editor `setCalls`.
- Spec 7's error list needs `limit.venue_in_use`, and spec 4's notice list `notice.ceilingChange`.

## Alternatives

- **Change the named wallet only.** An agent's wallets would drift apart, and the limits would hold
  for one wallet and not another. Rejected by the owner.
- **Add a chain's rules to an existing ceiling.** The wallet would need an account and rules it was
  not made with; a new wallet does this cleanly. Rejected.
- **Remove the venue from the limits too.** A ceiling change would loosen nothing but tighten
  limits without the owner asking. Rejected.
