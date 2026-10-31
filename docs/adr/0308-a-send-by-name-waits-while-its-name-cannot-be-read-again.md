# 0308. A send by name waits while its name cannot be read again

Status: Accepted

Accepted by the owner on 2026-11-01 ("wait and retry").

## Context

Spec 6 reads a send's `.bnb` name twice: at the resolve step, before anything is quoted, and
again when the wallet queue takes the confirmed send, before any signature. An address that
differs from the card's, or none, ends it `failed_check` with `name_moved` and
`notice.nameMoved`; `recheckName` of `@binference/engine/sends` makes that comparison and rejects
when the chain does not answer ([decision 0306](0306-a-bnb-name-resolves-through-space-id-s-registry-at-one-block-to-a-person-s-address.md)).
The specs leave three things open:

- What the queue does when the second read gets no answer: nothing may be signed, and the name
  has not moved either.
- What a proposal does when the first read gets no answer: `name/resolve` answers
  `name.resolver_down`, which a later call may get past.
- Where the card's name and address live, so the queue compares against what the owner saw.

The wallet queue already leaves a confirmed intent `confirmed` and tries again a block later when
no node answers while it prepares the first step, until the confirmation runs out
([decision 0120](0120-a-confirmation-that-ran-out-while-stopped-expires-the-intent.md)).

## Decision

- **No answer at the queue waits.** When the second read rejects, the queue signs nothing and
  leaves the send `confirmed`, as for a first step no node could prepare: it reads the name again
  a block later, after a restart too. Once the owner's confirmation runs out, the send expires
  with `notice.confirmationLapsed`. A read that answers ends the wait: the card's address goes
  on, anything else ends `name_moved`.
- **No answer at the proposal stores nothing.** A first read that rejects is
  `name.resolver_down`, as `name/resolve` answers it; a name no resolver serves, or that does not
  normalize, is `protocol.bad_args`. A name with no address ends `failed_check` with
  `name_unresolved`, one that points to a contract with `name_contract`.
- **The quote keeps the card's name.** A send's quote document holds the amount, the address it
  pays and, for a send by name, the name, when it was read, whether the address is a
  smart-account wallet and the other name its reverse record gives. The card's terms hash binds
  them, the queue compares the second read with them, and `IntentView.resolvedName` shows them.
- **`notice.nameMoved` says what changed.** Spec 4's message gains a choice on `{now}`: another
  address, the same address of another kind (a contract, or a smart-account wallet switched on or
  off), or no address; and it ends with the next step. A send that lapsed while it waited is told
  as a send, not a trade.

## Consequences

- A send stays cancellable while it waits, and never signs on a read that failed.
- A chain that stays silent for the whole confirmation costs the owner a new proposal, not a lost
  send.
- The queue reads the name once per take, so a waiting send reads it once a block.

## Alternatives

- **End the send at once with a new reason.** A node that misses one block would cost the owner
  the tap; the queue waits for a node elsewhere. Lost.
- **Sign the card's address when the chain is silent.** The second read exists to catch a name
  that moved after the card. Lost.
- **Read the name again at each tap and each card version.** A send's quote never goes stale, so
  no new card version re-reads anything; the queue's read is the one before the signature. Lost.
