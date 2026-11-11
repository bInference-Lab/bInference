---
title: Helpers, goals and skills the agent writes
description: Let the agent hand work to helpers, keep at a goal turn after turn, read its own status, and propose skills you apply.
---

The agent can hand a bounded task to a helper, work on a goal over many turns, tell you its own
state, and write skills for itself. None of these confirms a card or changes a limit: a trade they
lead to still waits for your tap, unless [auto mode](/guides/safety/#auto-mode) allows it.

## Helpers

A helper is a model run in the background, in a session of its own that starts with nothing but the
agent's brief, for one task that can run beside the chat, such as researching several tokens at
once. It reads, searches and works on the machine with the agent's read tools, shell and file
tools. It never proposes, asks you anything or starts a helper of its own. Its report reaches the
agent in a later turn, and the agent answers you from it. You see a line while the agent starts or
reads a helper, never a helper's own chat.

- At most 4 helpers of an agent run at once.
- A run has 10 minutes, or 1 to 30 when the agent asks.
- A helper uses the agent's main model unless the agent names another configured one, and spends
  the agent's own model budget.
- A report from a helper that read outside content marks the chat, as a web page does.
- Stop in the console, `/stop` in Telegram, Esc or `/stop` in the terminal chat, a freeze and a new
  chat stop the agent's helpers.
  A restart of binference ends the helpers that ran, and the agent hears it.

## The agent's status

`agent_status` reads the agent's own state: paper or live, frozen or not, its approval mode, the
models in force, today's model spend against the budget and when it resets, this chat's turns and
how full its context is, whether the chat read outside content, its running helpers, binference's
version and the time. Ask the agent about its model or its budget, and it answers from this.

Ask the agent to talk with another model in this chat, and it switches, to a model written as
`<provider>/<model>` of a provider `models.providers` configures. The switch holds until the chat is
cleared, changes no setting and needs no card; the daily model budget still caps it. `/ai` in
Telegram picks the agent's main model instead.

## Goals

A goal is a task the agent keeps working on, turn after turn, until it is done. Set one with
`/goal` and what the agent should achieve, in Telegram or in the terminal chat, or ask the agent to
set one:

```text
/goal Check every token I hold for a sell tax and write the results to taxes.md
```

After each turn, once the chat rests, binference starts the next goal turn. Your messages always go
first. A goal turn is a turn like any other: a trade it leads to needs your card unless auto mode
allows it, and every limit applies.

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `/goal`             | Shows the goal, its goal turns and spend, and the progress note |
| `/goal <objective>` | Sets the goal                                                   |
| `/goal pause`       | Pauses it                                                       |
| `/goal resume`      | Resumes it                                                      |
| `/goal clear`       | Clears it                                                       |

The console shows the goal above the chat, with Pause goal, Resume goal and Clear goal.

A chat has one goal, and a new chat forgets it. The agent marks the goal complete once it checked
that the whole objective is done, or blocked when the same blocker came back on 3 goal turns in a
row. A goal pauses, with a status line that says why:

- when you stop the agent, or it is frozen
- when the day's model budget is spent, or the goal's own budget, which the agent sets only when you
  name a dollar amount for it
- after 50 goal turns; `/goal resume` gives it 50 more
- after 3 goal turns in a row that made no progress

A goal turn that called no tool waits a minute before the next one. The agent sets a goal only when
you ask, and never in a chat that read outside content, so a page cannot give it one.

### The progress note

The agent keeps a short progress note beside its goal: a status and a plan of up to 12 steps, each
done, in progress or to do. Telegram keeps it in one message, edited in place; the console shows it
beside the chat; the terminal chat prints it when it changes.

## Skills the agent writes

The agent can propose a new skill, or a change to one of its workspace skills. A proposal never
applies by itself: you read it, then apply or reject it. It shows the agent's one-line reason, its
changes and the scan's findings, and any finding blocks Apply until the agent revises it. A chat
that read outside content proposes nothing, and the agent cannot apply, reject or remove a
proposal.

- In Telegram, `/skills` shows each proposal with Apply and Reject.
- In the console, the Skills screen shows each proposal with its changes; Apply asks once more.
- In the terminal: `binference skill proposals`, `binference skill show <proposal>`,
  `binference skill apply <proposal>` and `binference skill reject <proposal> --reason <text>`.

The agent hears your decision at its next turn, with your reason for a rejection. A workspace skill
added or changed by hand or by a command waits until you accept it: `/skills` shows it with Accept,
the console shows it on the Skills screen, and `binference skill accept <name>` accepts it in the
terminal. [Plugins, skills and MCP](/guides/plugins-and-skills/#skills-the-agent-proposes) says what
the scan looks for.

## See also

- [Commands](/reference/commands/) for `skill`.
- [Notices](/reference/notices/) for the skill notices, such as
  [`skillProposed`](/reference/notices/#skillproposed).
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for the helper, goal and skill tools.
