---
title: Chat with your agent
description: Talk with your agent in Telegram, the console and the terminal, answer its questions and cards, and go through the first chat.
---

Your agent has one conversation with you at a time, and every surface shows the same one: a message
you send in Telegram shows in the console and in the terminal chat too. The agent answers, proposes
trades on cards, and asks you questions with buttons. It never moves money without a card you
confirm, apart from what you allow it in [auto mode](/guides/safety/#auto-mode) and the fills of an
[auto order](/guides/auto-orders/) or an [alert rule](/guides/remote-and-webhooks/) you confirmed
once.

## Telegram

`binference init` asks for a bot token from BotFather and prints a link to your bot. The first
person who opens that link becomes the owner, and the bot answers that Telegram account only, in its
private chat. Messages from groups, channels and other people are ignored.

To pair another Telegram account, run `binference telegram pair` on the machine. It prints a new
link, valid 10 minutes. The current owner stays until someone opens it, and is told in their chat
when that happens.

Write to the bot as you would to a person. You may send up to 4 photos in one message, each a PNG,
JPEG or WebP of at most 5 MiB. A message that looks like a private key or another secret is deleted
unread, and the bot tells you so.

### Commands

The commands answer at once, without the agent's model. `/help` lists them:

| Command      | What it does                                                                |
| ------------ | --------------------------------------------------------------------------- |
| `/balance`   | Each wallet's total in USD and its top holdings                             |
| `/wallet`    | The agent's wallets: each address, its chain and its mode                   |
| `/positions` | Each position with its amount, value, average cost and P&L                  |
| `/orders`    | The active auto orders with their triggers and fills                        |
| `/cancel`    | Shows each card that waits for your answer, to cancel it                    |
| `/freeze`    | Freezes every agent at once                                                 |
| `/rescue`    | Opens the rescue card                                                       |
| `/paper`     | Switches the agent back to paper mode                                       |
| `/agents`    | Your agents, and the one this chat talks to                                 |
| `/use`       | Picks the agent this chat talks to, by its name                             |
| `/status`    | binference's state, its agents, freezes and health                          |
| `/limits`    | The agent's limits; its buttons can only make a limit stricter              |
| `/spend`     | Model spend today and this month against the budget                         |
| `/ai`        | The agent's models, with buttons to pick another main model                 |
| `/stop`      | Stops the agent's answer, its helpers and commands, and pauses its goal     |
| `/clear`     | Starts a new chat; notes, strategy and persona stay                         |
| `/goal`      | Gives the agent a goal to work on, or shows, pauses, resumes or clears it   |
| `/skills`    | The agent's skill proposals and waiting skills, with buttons to act on each |
| `/schedules` | The agent's schedules                                                       |
| `/console`   | Opens the console inside Telegram as the Mini App                           |
| `/replies`   | How the agent's replies and reasoning show here, a button for each choice   |
| `/config`    | Shows or changes a setting; a change opens a card you confirm               |
| `/restart`   | Restarts binference, and says here when it serves again                     |
| `/lang`      | The language binference uses with you                                       |
| `/help`      | The commands, one line each                                                 |

`/console` needs an HTTPS address for the engine: set it up with
[`binference expose`](/guides/remote-and-webhooks/), or name your own in `remote.publicUrl`. Without
one, the bot tells you how to publish one.

## The console

The console is the web interface the engine serves on your machine. Run `binference console` to get
a single-use link, valid 10 minutes, that pairs your browser. Its chat shows the same conversation
as Telegram, with Send and New chat buttons. Stop shows while the agent answers; Stop the agent,
above the chat, stops it whether it answers or not, as `/stop` does. You may attach up to 4 images
there too, with the same limits.

## The terminal chat

`binference chat` opens the chat in your terminal. Add `--agent <id>` when you have more than one
agent.

| Key                                | What it does                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Enter                              | Sends the message                                                                |
| Esc                                | Stops the answer                                                                 |
| `/stop`                            | Stops the agent, answering or not: its helpers and commands end, its goal pauses |
| Ctrl+Y                             | Confirms the card at the bottom                                                  |
| Ctrl+N                             | Cancels the card at the bottom                                                   |
| 1 to 9                             | Answers the open question, while the line is empty                               |
| Ctrl+U                             | Clears the line                                                                  |
| Ctrl+C, or Ctrl+D on an empty line | Leaves the chat                                                                  |

`/clear` starts a new chat, and `/help` lists the keys. The terminal chat sends no images.

## Cards

When the agent proposes a trade, a send, a stake or another action, a card shows its terms: what
leaves the wallet, the least that arrives, the fees, and any warning. Every surface shows the card;
the first answer counts, and every copy then turns into the receipt. In Telegram and the console,
press Confirm or Cancel. In the terminal, press Ctrl+Y or Ctrl+N, or run `binference confirm <id>`
or `binference deny <id>` in a shell.

A trade card lasts 60 seconds, other cards 10 minutes. The agent proposes one action per answer;
when it plans more, it says so and proposes the next once you answer the card. The
[safety guide](/guides/safety/) says which actions need a card and what the card checks.

## Questions

The agent may ask you a question with two to four answer buttons. Press one, or write your own
answer as your next message. A question closes when the agent asks a newer one, when you send
`/clear`, or after 24 hours.

## Messages during an answer

`chats.newMessageMode` decides what a message does while the agent is still answering. With `merge`,
the default, it joins the running answer at its next step. With `after`, it waits until the answer
ends. A message with images always waits.

## Outside content

When the agent reads the web, X, token data or an image, binference marks the chat as having read
outside content. A card that follows carries a warning, auto mode asks you on every card, and the
agent cannot send to an address that is not in your address book. The mark stays until you send
`/clear`.

## The first chat

A new agent starts with a first chat. Its file `FIRST-CHAT.md` holds 8 questions about how you
trade: how much the agent may trade, how long you hold, which tokens interest you, when to sell,
what to avoid, when to ask you first, and how often to report. The agent asks them one at a time,
after it has done what your first message asked. Questions 2 and 3 come with answer buttons; you may
always write another answer. Answer "Skip" to end the questions early.

From your answers the agent writes `STRATEGY.md` and `PERSONA.md`, then removes `FIRST-CHAT.md`. It
saves them only in a chat that read no outside content; after a marked chat, send `/clear` and
answer again. No answer sets a limit: limits change only with `binference limit set`. The first chat
is skipped while the agent is live.

## Workspace files

Each agent keeps `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md` and, until the
first chat ends, `FIRST-CHAT.md`, under `workspace/<agent>/` in the state folder. Each file holds at
most 12,000 characters, and all of them together 40,000. A change applies from the agent's next
answer. The agent itself may write only `STRATEGY.md` and `PERSONA.md`.

## Model budget

Each agent has a daily budget for its model calls, `defaults.modelBudgetUsdPerDay`, $3 by default.
Once it is spent, the chat pauses until the next day and you get the
[`budget`](/reference/notices/#budget) notice; auto orders keep running. `/spend` shows the spend.
`binference limit set modelBudgetUsdPerDay=5` changes the budget: a lower one applies at once, a
higher one after 24 hours.

## Schedules

Ask the agent to do something at set times, such as "review my portfolio every morning at 9". It
sets a schedule, and you get the [`scheduleSet`](/reference/notices/#scheduleset) notice. A schedule
only starts an answer of the agent at its time: it moves no money, and anything it proposes goes
through the same cards and caps as a proposal in chat. An agent keeps at most 50 schedules.
`/schedules` lists them; ask the agent to cancel one.

## Deleting chats

binference keeps each chat for `chats.keepDays`, 90 days by default, then removes it. To delete
chats now, run `binference chat delete` in a terminal, with `--agent <id>` for one agent or without
it for every agent, and type `delete chats` when it asks; `--yes` skips the question for a script.
In the console, Delete chats sits beside New chat in the agent's chat.

A running answer stops first. Then every message, turn, goal, progress note and helper of the
agent's chats goes at once, with the messages waiting for the agent and its open question; the
console and the terminal chat clear what they show, and the agent's next message starts a new chat.
Notes, workspace files, settings, auto orders, trades, positions, notices and model spend stay, and
so do the messages already in your Telegram chat. Backups made before still hold the chats until
they are pruned. binference must be running: with the agent offline, the command says to run
`binference start` and try again.

## See also

- [Commands](/reference/commands/) for `chat`, `chat delete`, `console`, `confirm`, `deny` and
  `telegram pair`.
- [Config keys](/reference/config/) for `telegram.*`, `models.*` and `chats.*`.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for what the agent can read and propose.
