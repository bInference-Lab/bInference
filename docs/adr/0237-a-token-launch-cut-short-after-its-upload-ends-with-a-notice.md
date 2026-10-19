# 0237. A token launch cut short after its upload ends with a notice

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
uploads a launch's words and picture before its build, then moves it to `quoted`, where a timer
follows its pin. The second review of the launch found four gaps:

- A fault or a stop between the upload and `quoted` left the launch in `checked` for good: no
  reason, no notice, though its words and picture may be public.
- A build that failed after the upload ended the launch, but only the proposer heard.
- The timer read one page of 50 intents in the followed states, of every kind, and kept the
  launches: 50 other intents left there hid every launch. One launch whose follow threw stopped the
  launches after it.
- A launch a stop left between its pin and its card opened its card after any stop, on a plan and a
  fee built long before.

## Decision

- **Every end after the upload is told.** Once the launchpad is asked to upload, any end of the
  launch before its card, `failed_check` or `cancelled`, sends the owner `notice.launchStopped`
  with its reason. The notice says nothing was signed, and that the picture and words may be public
  on the launchpad.
- **`upload_lost`.** A fault or a stop once the upload began, before the launch waits in `quoted`,
  ends it `failed_check` with the new check reason `upload_lost` at once, on a signal of its own.
  When that write fails too, the startup's repair ends each live launch it finds in `checked`
  with `upload_lost` before the pin timer starts, and the timer ends one still in `checked` a pin
  wait after it was checked.
- **The timer reads every page.** The pin follow pages through every live intent in `checked`,
  `quoted`, `assessed` or `simulated` and follows the launches among them, one at a time. A launch
  whose follow throws is passed over, and once every launch was followed the run fails with
  `engine.pin_check_failed` naming those that threw, which the timer logs.
- **A stale launch is cancelled.** A launch in `assessed` or `simulated` once its pin wait and the
  agent's card life (`cardOtherExpiryS`) have both passed is cancelled as `engine_stopping`, with
  the notice, rather than opening its card.
- **The first follow.** `intent/propose` follows a launch's pin once before it answers; a fault in
  that follow leaves the launch where it got to, for the timer, and the proposal answers it.

## Consequences

- No launch whose words may be public ends without the owner hearing of it, and none stays in
  `checked` past a restart.
- The check reasons gain `upload_lost`; `notice.launchStopped` gains words for `upload_lost`,
  `engine_stopping` and any other reason; the engine's `checkPins` takes `isRepair`, and the
  startup calls it so after the order fill repair.
- The pin follow reads more rows when many intents wait in its states; each page holds 50.
- A launch whose plan went stale is proposed again by the owner; nothing re-quotes it.

## Alternatives

- **A marker written before the upload.** It would tell a launch that never uploaded from one
  that did, but needs a store change; ending every launch left in `checked` with words that say
  the picture may be public tells the owner the same. Rejected.
- **Filter launches in the store query.** It needs a kind filter in every intent store adapter;
  paging reaches the launches without one. Rejected for now.
- **Re-quote a stale launch.** A second upload or build would change what the card shows.
  Rejected, as decision 0235 rejects it at the tap.
