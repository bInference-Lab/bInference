# 0162. A restore never loosens the install, and swaps all or nothing

Status: Accepted

Accepted by the owner on 2026-10-11.

Amends [decision 0152](0152-a-running-install-restores-a-backup-from-the-cli-between-a-stop-and-a-start.md).

## Context

[Decision 0152](0152-a-running-install-restores-a-backup-from-the-cli-between-a-stop-and-a-start.md)
restores a backup by replacing `engine.sqlite` whole. That file holds what guards the funds: the
revoked console devices and client tokens, the Telegram owner and the unused pairing codes, the
Mini App's launches and tickets, every freeze, the rescue address and the change that waits for
it, each agent's approval mode, send level, limits and address book, and the confirmed intents the
rolling 24-hour cap counts. A backup is always older than the state it replaces. Restoring it
undoes what the owner did since: a device revoked after a theft signs in again, a replaced Telegram
owner is the owner again, a freeze is gone, auto mode and looser limits are back, and the cap no
longer counts the day's spending, so auto mode may spend a second full cap. Nothing told the owner.

The swap moved files one rename at a time and kept no account of a rename that failed: a file held
open on Windows left the state folder with the backup's money database beside the current config,
and the folder the backup was unpacked into, with the rest of the restored files, was removed. A
start that failed on the restored state was not undone either.

## Decision

- **Before the swap, the restore reads the state it replaces** and carries it into the restored
  `engine.sqlite`, in one transaction, once the engine has stopped and under the engine lock:
  - the access tables as they are now: client tokens, console devices and their browser push
    subscriptions, pairing and start codes, Mini App launches and tickets. A revoke stays revoked,
    and a device or token the backup holds but the replaced state no longer does is gone;
  - the Telegram owner, the rescue address, its pending change and the rescue rules: the newer ones;
  - a freeze of the install or of an agent stays frozen; an archived agent stays archived, a paper
    agent paper, a manual agent manual;
  - each agent's send level and each of its limits is the stricter of the two in effect now, by
    the comparisons of [decision 0111](../DECISIONS.md#d0111); two values neither of which is
    stricter, such as venue lists that each hold one the other lacks, keep the replaced state's;
    a looser setting the owner asked for since still comes at its time;
  - an address book entry removed since stays removed;
  - every outflow the rolling 24-hour cap counts now goes into `carried_outflows`, which the cap
    counts in the place of the restored copy's own count of the same intent;
  - the backup records the restored copy lacks.
- **The owner sees what the restore changes and confirms.** Before anything moves, the restore
  shows what it keeps as it is now, where the history ends (the backup's time and the last change
  it leaves behind), the agents and wallets that come or go, and the backup's stricter guards that
  stay. The owner goes on by typing the backup's day, `yyyy-mm-dd`; anything else changes nothing.
  A replaced `engine.sqlite` that does not open is said so, and nothing of it can be carried. One
  from an older schema is refused until binference started once on it.
- **The swap is all or nothing.** The restored files are staged in a folder of the state folder,
  so every move is a rename on one disk. Each rename is journaled; when one fails, every rename
  made is reversed, newest first, and the restore is refused with the engine started as it ran.
  A reversal never moves onto a path a failed move still holds. When a reversal fails too, the
  restore names where the replaced state and the staged files wait, keeps both, and starts nothing.
  The staged folder is removed only once the swap is done or undone.
- **A start that fails is undone.** After the swap the engine starts as it ran. When it does not
  reach `ready` or `locked` (it refused, or the service never answered), the restore stops it,
  undoes the swap under the engine lock, starts the engine again on the state it had, and exits 1.
  A `locked` engine counts as started: the manual unlock mode and an unreachable Privy start locked
  by design.
- `init --attach --restore` follows the same rules when the folder holds a state to replace.

## Consequences

- A restore can only tighten what guards the funds, never loosen it; a property test checks this
  for any pair of states, now and after every pending change comes due.
- History after the backup stays only in the replaced state, which waits 7 days in `replaced/`.
- The rolling cap may count an outflow twice over a restore of a restore: the stricter error.
- Every restore asks one more question.

## Alternatives

- **Show the differences and let the owner pick each one.** Every choice there could loosen a
  guard; the rule that the stricter or newer value wins needs no choice. Rejected.
- **Copy the recent intents themselves into the restored copy.** Their transactions, cards and
  nonces would have to come too, and reconciliation already reads the chain. Rejected.
- **Restore only the history and keep the replaced settings whole.** A backup exists to bring back
  a damaged state; its settings must be able to come back when they are stricter. Rejected.
