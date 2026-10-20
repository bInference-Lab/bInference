# 0267. After downtime, each order is checked once on a fresh price, and the owner gets one report

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0066](../DECISIONS.md#d0066) says each auto order checks the price at a resume, fills
only if its trigger still holds within its worst price, else is skipped and reported, and the
owner gets one report. The orders already behave close to that: a price order fires on its level,
never on a crossing ([decision 0196](../DECISIONS.md#d0196)), and its fill is held to its worst
price; a missed DCA period is never bought ([decision 0246](../DECISIONS.md#d0246)); a late copy
buy is never made and a late copy sale is mirrored within the hour
([decision 0260](../DECISIONS.md#d0260)); a missed schedule runs once
([decision 0232](../DECISIONS.md#d0232)). Each piece tells its own skips, one notice each, and
nothing counts what a resume did. [Spec 4](../specs/cards-and-messages.md) has `notice.resumed`
with `{checked}`, `{filled}` and `{skipped}`, and [spec 8](../specs/runtime.md) has
`inbox/resumeReport`; neither says what counts as checked or skipped, nor when the report goes.

## Decision

- **A re-check takes every order active at the resume.** Each limit, take-profit, stop-loss and
  trailing order is judged once on the first confirmed price of its token read after the resume.
  A trigger that holds fires the fill as at any price, held to every bound of the order; one that
  does not is skipped as `trigger_not_met`, or `rearming` for an order that filled before and
  waits for its price to leave the trigger, and the order waits on. No price within two minutes
  is `no_fresh_price`. A fill's own skip gives its reason; an exit order its position's sale ended
  is `position_closed`; a fill that waited behind another fill of the agent, or after its own last
  skips, is `behind_fill`; a fill whose old run still held the order waits for the next price. A
  live fill handed to the executor is `sent`, not filled: it may still fail on chain.
- **A skip row the start's repair wrote counts.** A price order whose fill a stop cut off counts
  as skipped with that row's reason, unless the re-check filled it.
- **DCA and copy orders keep their rules.** A missed period, a late copy buy and a copy sale past
  its hour are skipped as before. The first such row of each order (`missed`, `late`,
  `copy_sale_lapsed`) that lands while the re-check is open counts in its report, and shows there
  as skipped though a fill of the order came too, since that fill tells itself.
- **Checked counts every order once:** filled, sent or skipped.
- **One report.** It goes when every price order has its outcome, at least 20 seconds after the
  resume so the DCA and copy runs land their skips, and at most two minutes after it, plus the
  last fills' 30 seconds. `notice.resumed` names a start, a pause of the engine or a clock set back
  and how long it lasted, then a line for the live fills sent and not yet settled, up to three
  lines of skips by reason, the commonest first, and one line for the rest.
- **Silent when nothing was checked (the owner's choice).** A resume whose re-check checked no
  order, none filled and none skipped, sends no `notice.resumed`. Prices read before it are fenced
  off all the same ([decision 0268](../DECISIONS.md#d0268)).
- **No skip is lost.** The report holds two kinds of skip row: that of the fill its own first
  judgment of a price order started, and a DCA or copy order's first skip of the downtime. Every
  other skip, of any order, is told by its own notice as usual, within the usual limits. A held
  row stays unannounced until the report went out, which then marks it. A report that fails tells
  the rows it held as usual; a stop leaves them for the next start to tell. A fill still sends its
  own notice, as every fill does ([spec 6](../specs/intent-states.md) section 8).
- **The agent hears it too.** Each agent with a checked order gets `inbox/resumeReport` with its
  own counts and each order's outcome, at most 50. It starts no turn; the agent's next turn takes
  it as a line before the owner's message. One report waits per chat, the newest: a new one
  replaces the one before, so reports never hold back the owner's message. An agent whose inbox
  is full gets none.
- **A resume while a re-check is open joins it.** The span adds up, a start or a clock step names
  the report, and orders not yet judged wait for a price read after the new resume. The engine is
  marked alive only once no re-check is open, and before the report goes out: a stop or a fault
  after the mark never reports the span twice, and the skips the report held and could not mark
  are told at the next start.

## Consequences

- The price triggers tell the re-check each order's first judgment and its fill's end.
- The announcing of fill rows asks the re-check which skips it holds, and leaves those unannounced.
- `CheckedSkipReason` adds `trigger_not_met`, `rearming`, `behind_fill`, `no_fresh_price` and
  `position_closed`, each with a message in English and Chinese; the report and
  `inbox/resumeReport` add the `sent` outcome and the `clock` cause.
- The runtime keeps one resume report waiting in the chat queue until a turn takes it.

## Alternatives

- **Count only orders whose trigger moved while the engine was off.** The engine read no price
  then, so it cannot tell. Rejected.
- **Keep every piece's own notices and add the report.** The owner of an install with many orders
  would get one notice per order after each night's sleep. Rejected.
- **Report every resume, even one with nothing checked.** A restart with no auto order would
  still send a notice that tells the owner nothing. Rejected by the owner.
- **Wait for the report until every order was judged, however long.** A token that lost its pool
  would hold the report forever. Rejected for the two minutes.
