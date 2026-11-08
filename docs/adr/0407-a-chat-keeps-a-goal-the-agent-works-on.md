# 0407. A chat keeps a goal the agent works on

Status: Accepted

Accepted by the tech lead on 2026-11-08.

## Context

The owner asked for an agent that keeps working on a larger task, such as "find three tokens with
steady volume this week and report them", without a message from the owner for each step, and that
keeps one status of the work the owner can read without the transcript. A turn has 25 tool calls
and 10 minutes (runtime spec, section 9), and a turn starts only from a message, so today the agent
stops after each turn and waits.

Working on its own must not open a way to move money or to spend without bound. Every proposal
must still reach the owner's card unless auto mode already allows it, outside content read in one
turn must keep marking the turns after it (rule 13), and the agent's daily model budget must keep
capping what it spends.

## Decision

- **A goal** is kept per chat session in `agent.sqlite` (agent migration 0008, `goals`): its
  objective (at most 2,000 characters), status (`active`, `paused`, `blocked`, `complete`), why it
  paused, the agent's note when it completed or blocked it, an optional budget and the spend so
  far in micro-dollars, its goal turns, the goal turns in a row that made no progress, its times and
  a row version. A chat has at most one goal; setting a second is refused until it is cleared, and
  a clear of the chat (`chat/clear`) forgets the goal and the progress note of the chat it closes.
- **A progress note** is kept per chat session too (`progress_notes`): a markdown of at most 2,000
  characters and a plan of at most 12 steps, each `done`, `doing` or `todo`, replaced whole on each
  write; one with no markdown and no step removes it.
- **Goal turns.** While the goal is active, after each turn of its chat the runtime asks the engine
  for the next one with `goal/continue`; the engine stores it as an `inbox/message` with `goalTurn`
  set and binference's words naming the goal turn and the objective, which starts a turn. The
  runtime asks only once the chat rests: no turn of the agent runs and no message waits to start
  one. The owner's message goes first: goal words taken together with another message are dropped,
  and goal words never join a running turn at a merge point. Each turn's live facts name the goal.
  At a runtime start, every active goal asks for its next goal turn.
- **Limits.** Each pauses the goal with its reason, and the owner hears it in a status line:
  the agent's daily model budget (a turn refused or answered with the budget spent, `budget`); the
  goal's own budget when set, counted from the spend of every turn of the chat since the goal was
  set (`goal_budget`); 50 goal turns (`turn_limit`); 3 goal turns in a row that called no tool,
  ended with a failed tool, failed or looped (`no_progress`). A goal turn that called no tool waits a
  minute before the next one, so the agent never spins without work. An owner's turn clears the
  count of turns with no progress. A resume clears that count too, and starts again the limit the
  goal paused on: the spend after `goal_budget`, the goal turns after `turn_limit`.
- **Money safety is unchanged.** A goal turn is a turn like any other: it proposes through the same
  tools, so a trade still needs the owner's card unless auto mode allows it, and the engine's
  limits, budget and freeze apply as before. A goal turn starts marked as outside content when the
  turn before it ended marked, beside the session's history, which marks it too. `goal_set` is
  refused in a turn whose context holds outside content, so a page cannot set the agent a goal.
  Helpers get none of the goal tools. The engine refuses `goal/continue` for a frozen agent, and the
  runtime pauses the goal (`frozen`).
- **Owner control.** `goal/get` (read), `goal/set` and `goal/change` (`pause`, `resume`, `clear`)
  are routed operations with the `chat` scope; the runtime takes a change from the `owner` origin
  only. Telegram's `/goal`, `/goal <objective>`, `/goal pause`, `/goal resume` and `/goal clear`,
  the same words in terminal chat, and the console's goal panel with Pause, Resume and Clear call
  them. The owner's `/stop` pauses the goal (`stopped`). Setting a goal needs no card: it moves no
  money.
- **Agent tools.** `goal_set` (control) only on the owner's explicit request in this chat, refused
  while a goal exists; `goal_read` (read); `goal_update` (control) marks the goal `complete` only
  when the whole objective is verified done, or `blocked` only when the same blocker came back on
  at least 3 goal turns in a row; `progress_note` (control) replaces the note, and refuses a new
  note of fewer than two steps.
- **What every surface shows.** Each change reaches the surfaces as a `chat/goal` push (through
  `goal/show`, from the current runtime only), with the goal and the note as they stand. A change of
  the goal shows a status line in both languages: set, paused with why, resumed, complete, blocked,
  cleared. Telegram keeps one message per chat for the progress note, sent once and edited in place
  at most once every 5 seconds; the console shows it beside the chat; terminal chat prints it when
  it changes.

## Consequences

- The owner can give the agent a task of many steps and read its progress in one place, and the
  agent works on it until it is done, blocked, paused or out of budget.
- A goal spends model budget without a message from the owner: at most 50 goal turns per goal, its
  own budget when set, and the daily budget that caps every turn.
- A goal turn that the engine refuses for a reason other than the budget or a freeze, such as an
  engine out of reach, starts none; the next turn of the chat or a resume asks again.
- `SessionStore` is unchanged; `GoalStore` is a new port with its contract on SQLite, memory and
  Postgres. The protocol gains `goal/get`, `goal/set`, `goal/change`, `goal/continue`, `goal/show`,
  the `chat/goal` push, `goalTurn` on `inbox/message` and the `goal.*` error codes.

## Alternatives

- **A schedule that wakes the agent every few minutes.** It would run whether or not the last turn
  made progress, and know nothing of the objective, its spend or its end.
- **Longer turns.** A turn's 25 tool calls and 10 minutes bound a runaway turn; raising them for one
  task would raise them for every turn.
- **A budget in tokens.** binference counts model spend in micro-dollars, as the daily budget does,
  so a budget in dollars reads the same as the owner's other limits.
- **Pause at any no-tool turn.** A turn that only reports would end the goal; a minute's wait and
  three strikes leave room for a turn that thinks before it acts.
