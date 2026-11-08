# 0403. The agent hands bounded work to helpers

Status: Accepted

Accepted by the tech lead on 2026-11-08.

## Context

The owner asked for an agent that can hand off work: research several tokens at once, read a long
page set while it keeps talking, or have a second look at its own findings. One agent turn runs at
a time per agent (runtime spec, section 3.4), and a turn has 25 tool calls and 10 minutes, so a
long task blocks the owner's chat and runs out of room.

Handing off work must not open a new way to move money. A proposal must come from a turn the
owner can see, with the outside-content mark of everything that turn read (rule 13), and only the
agent may ask the owner anything.

## Decision

- **A helper** is a session of the agent in `agent.sqlite` (agent migration 0006, `helpers`),
  with `surface` `helper`, run through the runtime's turn loop in its own line of work, so it never
  blocks the owner's chat and never takes the agent's place in the engine. Its context starts
  clean: binference's helper instructions and its task as its first message, no chat history and
  no workspace files.
- **Tools.** `helper_start` (control) takes the whole brief as `task`, a `label`, an optional
  `model` and an optional `timeoutMinutes`, and answers the helper's id; the result arrives in a
  later turn. `helper_list` (read) lists the agent's helpers with their state (`running`, `done`,
  `failed`, `stopped`, `timed_out`) and times. `helper_read` (read) answers a helper's result and
  its last messages within the 12,000 characters of a tool result. `helper_send` (control) sends a
  follow-up, which starts another run of the helper; for one that runs, up to 4 wait for its run
  to end. `helper_stop` (control) stops a running one.
  The descriptions tell the agent to work directly by default, to hand off only a bounded,
  independent task where running in parallel or a second look helps, never a quick lookup or a
  single read, and to do other work after a start.
- **What a helper may call.** Each tool declares whether a helper may call it, by its kind unless
  it says otherwise: reads and machine tools may (web, X, notes search and get, token and market
  reads, files, shell, images to look at); propose and control tools never may, and a propose or
  control tool that declares otherwise is refused when it is declared. `schedule_list` and the
  helper tools declare that no helper calls them, so a helper starts no helper. The helper's tool
  box is built from those declarations, and its journal refuses a proposal as a second wall.
- **Outside content.** A helper's turns keep their own mark. Its result reaches the agent as an
  engine message (`helper/ended`, an `inbox/message` with `outsideContent`): when any run of the
  helper read outside content, the wake-up turn starts marked, as an alert's does, so a trade after
  it always gets a card. `helper_read` of such a helper is outside content too.
- **Limits.** At most 4 of an agent's helpers run at once; a fifth start is refused. A run has 10
  minutes by default, 1 to 30 when the agent asks, and ends `timed_out`. A helper's turns spend the
  agent's own model budget: each attempt is recorded with `usage/record` under the helper's turn,
  so the budget and the daily summary count it. A start or follow-up is refused, and a run makes no
  further model call, once the engine last answered the agent's budget as spent. A helper uses the agent's main model unless the agent names another configured model as
  `<provider>/<model>`; a provider `models.providers` lacks is refused.
- **Stops.** The owner's `/stop`, a freeze and a clear stop the agent's helpers, and no wake-up
  follows. A helper still running when the runtime stops ends `stopped` at the next start, and the
  agent hears it in one engine message.
- **What the owner sees.** A progress line for each helper tool (`turn.tool.helperStart` and the
  others), then the agent's answer once a result arrives. No surface shows a helper's own chat.

## Consequences

- The agent can run up to 4 bounded tasks beside the owner's chat, each with its own 25 tool
  calls, and answer from their results.
- A helper's model calls cost the same as the agent's; four helpers can spend the day's budget
  faster, and the budget stops them as it stops the agent.
- The engine answers the budget left only after a call, so a run's first call may still be
  charged when another turn spent the budget since the engine last answered.
- The engine gains `helper/ended` and an optional `outsideContent` on `inbox/message`; nothing
  else in the engine changes, and its running turn per agent stays the agent's own.

## Alternatives

- **Run a helper as an engine turn.** The engine keeps one running turn per agent with its mark;
  a second one would replace the agent's and lose its mark.
- **Give a helper every tool and rely on cards.** A helper's proposal would carry no mark of what
  it read and reach the owner from a chat they never saw.
- **Fork the agent's chat into the helper.** A helper would start with the owner's whole history
  and its outside content, and cost more for a bounded task.
- **Keep helpers in memory only.** A restart would lose every helper's state and result.
