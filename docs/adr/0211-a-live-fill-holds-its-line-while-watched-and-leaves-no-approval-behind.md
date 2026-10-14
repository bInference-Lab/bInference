# 0211. A live fill holds its line while watched and leaves no approval behind

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Decision 0210](0210-a-live-order-fill-signs-under-its-order-s-grant-and-counts-once-it-settles.md)
signs a live order fill under its order's grant and counts it once it settles. A second review of
that work found cases it left open:

- A fill whose transaction a relay dropped ended `failed_onchain` and freed the agent's line,
  though its bytes can land for 600 blocks more; the next fill could then fill the order twice. A
  restart forgot the watch, and a late landing counted on its order apart from its fill's row.
- The signer checked a grant's terms but signed any number of fills under one order count while
  the grant lived, and took any grant lifetime the engine sent.
- A landed fill that would pass its order's most fills was stored without a word, and one that
  could not be valued held the line until a restart.
- A sale that reverted fired again at every block, paying gas each time.
- A freeze between a sale's approval and its swap left the approval standing.
- A fill the wallet queue refused waited out its grant and held the line, and the owner heard of a
  lapse rather than the cause.
- The fill's terms hash was computed when the grant was made, not stored as the fill was
  confirmed; the queue signed fills while the executor's switch was off; and an owner who cancels
  a fill saw its order fire it again.

## Decision

- **The line holds while a dropped fill is watched.** A live fill that ended `failed_onchain` with
  `stuck_dropped` holds its agent's line for 600 blocks of its chain from the drop, as long as its
  bytes may land. The check reads the store, and the executor watches every such fill again at the
  start. A landing in that time counts on its order in one write with the fill's `filled` row,
  which names the fill: a second landing of the same fill writes nothing.
- **Never an over-count in silence.** A landing counts whatever its order became, as decision
  0210 says. One that takes the order past its most fills is still counted, since the chain holds
  it, and the owner hears `notice.orderOverfilled` with the count and the most.
- **A fill that cannot be valued.** A landed fill whose amounts or prices cannot be read counts on
  its order after `settleAfterBlocks`, freeing the line, with `notice.fillUnvalued`; its value is
  read again in the background at each next try.
- **Failures on chain back off, then stop.** After 2 fills of an order failed on chain since its
  last fill, its next fill waits 15 seconds, doubling to 5 minutes. After 5, the order is
  cancelled and the owner hears `notice.fillsFailing` with the count.
- **A freeze finishes a sale under way, or resets its approval** (owner, 2026-10-13). A freeze
  lets a confirmed fill whose first step landed sign and send its later steps, so a sale's swap
  follows its approval; the order stays paused, and no fill starts. The signer allows a step after
  the first while the order is paused. A fill whose later step can no longer be signed, as its grant
  ran out or its order ended, while an approval its landed steps set still stands, sends one more
  step, signed under its grant: an approval of the same token to the same spender
  for 0. The signer signs that reset, and only that, whatever the order became, up to a minute
  after the grant expired, and the owner hears `notice.approvalReset`. After a restart, recovery
  does the same with a fill whose first step landed and whose later step was never signed: it
  goes on under the grant while it holds, or resets the approval, and sends a stored reset before
  it ends the fill.
- **One fill per order count, and a bounded grant.** The signer keeps, while it runs, which fill
  intent each order count signed for, until a minute after its grant expires, and refuses a step
  of any other intent under the same count with rule 5. It refuses a grant longer than 60
  seconds, or granted after now.
- **A refused fill ends at once.** When the wallet queue takes a fill it will not sign, the fill
  is cancelled unsigned at once, freeing the line, and its order's row names the cause:
  `live_fills_off`, `paper_only`, the policy's reason, `order_inactive`, or `fill_failed` for a fill
  whose stored terms no longer hold.
- **The terms hash is stored at confirmation.** The fill's terms hash, the SHA-256 of a tagged,
  versioned document (`v: 1`, `kind: "orderFill"`) of the intent, the order, its confirmed card's
  terms hash, the fills before, the request, the quote and the plan, is stored with the fill's
  authorization as the fill is confirmed. The queue signs only while the fill as it reads it hashes
  to it again.
- **The executor's own switch.** The wallet queue refuses every live fill while the executor's
  switch for live fills is off, whatever the engine's switch says.
- **An owner's cancel ends the order.** A fill the owner cancels before it is signed ends its
  order, `cancelled`, with the skip `owner_cancelled`, so its trigger, still met, does not fire it
  again.
- **The crash suite** kills the engine during a stop-loss sale's two steps as well as a buy, with
  the signer's own service and every hard rule in the crash engine's process, and once while it
  watches a dropped fill whose bytes land later. A test keeps the crash suite's test orders out of
  the shipped build.
- **Still off.** The switch stays off and `order/create` keeps refusing live price orders.

## Consequences

- A dropped fill holds its agent's fills for up to 600 blocks, about 7.5 minutes on BSC.
- A sale stopped halfway costs one more transaction's fee for the reset.
- Spec 5's rule 5 names the single use, the lifetime, a later step under a pause and the reset;
  spec 6's freeze text names the sale that finishes; spec 6 gains `owner_cancelled`.
- A fill stored before this decision has no terms hash and is refused at the queue; none was ever
  signed, since live fills never ran.

## Alternatives

- **Release the line at the drop and count a late landing as an extra fill.** The order would
  fill twice. Rejected for the hold.
- **A freeze stops a sale between its steps.** The approval would stand while the agent is
  frozen, which is the moment the owner fears misuse. Rejected by the owner.
- **Keep single use in the engine only.** An engine that lost its store or misbehaves could ask
  twice. Rejected: the signer holds it too.
- **Pause the order on an owner's cancel.** A pause is a freeze's; nothing would take it back.
  Rejected for ending the order, which the owner can make again.
