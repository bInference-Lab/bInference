# 0110. The owner key saves a new rescue address in every ceiling

Status: Accepted

## Context

Since [decision 0091](../DECISIONS.md#d0091) each wallet's ceiling, its Privy policy, lets a send
pay only the rescue address and the addresses saved with the owner key. A new rescue address
waits 24 hours in the engine ([decision 0044](../DECISIONS.md#d0044)), but nothing put it in the
ceilings, so a rescue to it would be refused by Privy. Only the policy's owner, the owner key,
changes a policy, and the CLI forgets the key after one request
([spec 5, section 2](../specs/keys-and-backups.md#section-2)). Privy signs a rule change over its
method, URL, body and `privy-` headers, the request expiry among them; its docs set no maximum
expiry and no not-before time. The owner decided on 2026-10-09.

## Decision

- `safety/setRescueAddress` takes the owner key code and runs over IPC only. `binference rescue
set <address>` asks for the code with hidden input; no flag takes it.
- With the key, the engine sets each wallet's send rules at once to the address in effect, the new
  one and the saved addresses: the old address keeps working until the change takes effect.
- With the same key it signs two more rule changes and sends neither: one that leaves out the old
  address, valid from the change's time until 7 days after it, and one that leaves out the new
  address, valid until the change's time. The engine keeps both, and sends the first once the
  change takes effect and the second when the owner cancels.
- A change signed ahead is sent only while each rule still lists what it listed when it was
  signed, so it never undoes a later change. When it cannot be sent, the owner gets a notice to
  run `binference rescue set` again.
- Protocol version 1 keeps `ownerKey` an optional field and the operation's transport `any`, so
  the change stays an addition; the engine refuses a call without the key or over WebSocket. The
  next protocol version makes both part of the schema.

## Consequences

- A rescue pays the new address once the change takes effect, without the owner key that day.
- A signature kept in the store authorizes only the removal of one address from the ceilings, a
  braking change. Someone who reads the store can only stop sends to an address early, which
  fails closed.
- The engine sends the change when it settles after the change's time: on a rescue address call
  now, and on the composition root's timer once the engine's startup work schedules one.
- Custody gains a rule change signed by the policy owner, which `address/add` will use too.

## Alternatives

- **Leave the old address in the ceilings until the next owner-key action.** The ceilings would
  allow sends to an address the owner replaced. Rejected.
- **Keep the owner key in the engine for 24 hours.** It breaks the rule that the key is used once
  and forgotten. Rejected.
- **Raise the protocol to version 2 now.** Every client would move for one field while sibling
  work adds operations to version 1. Rejected.
