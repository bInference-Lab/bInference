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
  does not is skipped as `trigger_not_met`, and the order waits on. No price within two minutes is
  `no_fresh_price`. A fill's own skip gives its reason; an exit order its position's sale ended is
  `position_closed`; a fill behind another fill of the agent is `fill_waiting`.
- **DCA and copy orders keep their rules.** A missed period, a late copy buy and a copy sale past
  its hour are skipped as before; a skip row of the downtime's reasons (`missed`, `late`,
  `copy_sale_lapsed`) that lands while the re-check is open counts in its report.
- **Checked is filled plus skipped.** An order counts once: filled when the re-check filled it.
- **One report.** It goes when every price order has its outcome, at least 20 seconds after the
  resume so the DCA and copy runs land their skips, and at most two minutes after it, plus the
  last fills' 30 seconds. `notice.resumed` names a start or a sleep and how long it lasted, then up
  to three lines of skips by reason, the commonest first, and one line for the rest.
- **Silent when nothing was checked (the owner's choice).** A resume whose re-check checked no
  order, none filled and none skipped, sends no `notice.resumed`. Prices read before it are fenced
  off all the same ([decision 0268](../DECISIONS.md#d0268)).
- **Skips are told once.** A skip the report counts keeps its `order_fills` row; its own notice is
  marked announced and not sent. A fill still sends its own notice, as every fill does
  ([spec 6](../specs/intent-states.md) section 8).
- **The agent hears it too.** Each agent with a checked order gets `inbox/resumeReport` with its
  own counts and each order's outcome, at most 50. It starts no turn; the agent's next turn takes
  it as a line before the owner's message. An agent whose inbox is full gets none.
- **A resume while a re-check is open joins it.** The span adds up, a start makes it a stop of the
  engine, and orders not yet judged wait for a price read after the new resume.

## Consequences

- The price triggers tell the re-check each order's first judgment and its fill's end.
- The announcing of fill rows asks the re-check which skips it holds.
- `CheckedSkipReason` adds `trigger_not_met`, `no_fresh_price` and `position_closed`, each with a
  message in English and Chinese.
- The runtime keeps a resume report in the chat queue until a turn takes it.

## Alternatives

- **Count only orders whose trigger moved while the engine was off.** The engine read no price
  then, so it cannot tell. Rejected.
- **Keep every piece's own notices and add the report.** The owner of an install with many orders
  would get one notice per order after each night's sleep. Rejected.
- **Report every resume, even one with nothing checked.** A restart with no auto order would
  still send a notice that tells the owner nothing. Rejected by the owner.
- **Wait for the report until every order was judged, however long.** A token that lost its pool
  would hold the report forever. Rejected for the two minutes.
