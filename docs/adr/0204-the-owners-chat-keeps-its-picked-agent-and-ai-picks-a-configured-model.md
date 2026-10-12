# 0204. The owner's chat keeps its picked agent, and /ai picks a configured model

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Spec 4](../specs/cards-and-messages.md#section-5) section 5 lists `/agents`, `/ai`, `/clear` and
`/schedules` for the owner's Telegram chat, and spec 1 section 7.7 adds the agent's questions
(`turn/ask`, `chat/answer`). Topics stay off until the check of
[decision 0186](../DECISIONS.md#d0186) is answered, so one private chat serves every agent. The
specs leave open:

- **Which agent a message goes to** with several agents, and whether the pick outlasts a restart.
- **What `/ai` reads.** `model/list` takes no agent, so nothing says which model an agent uses now.
- **How a button names a model.** A model reference can pass Telegram's 64 bytes of callback data.
- **What a model the owner picks replaces**, and how the agent runtime learns of it: the runtime
  reads its settings at its start ([spec 8](../specs/runtime.md#section-2-2) section 2.2).
- **`chat/answer`'s `choice`**: a label or a place.
- **When a question expires**: the engine has no timer for it.
- **`/schedules`** before the engine serves schedules.

## Decision

- **The picked agent.** With one agent not archived, the chat talks to it. `/use <name or id>`
  picks an agent; the pick is kept with the paired owner (`telegram_owner.agent_id`), so it outlasts
  a restart, and a new pairing clears it. A pick that is archived, or missing, counts as none. With
  several agents and none picked, a message is not sent, and the reply lists the agents and how to
  pick one. While more than one agent is not archived, each answer and status line of an agent in
  the chat starts with its name: `telegram.chat.agent`, "{agent} · {text}".
- **`model/list` takes `{ agent? }`.** Each view may carry `current: true`: the model the agent's
  next turn uses for its role. `model/set` answers the same list for its agent.
- **`/ai`** shows the main and fast models the agent uses now, and one button per distinct
  configured model (`models.main`, `models.fast`, `models.vision` and the fallbacks, in config
  order). A button carries `bnf1:m:s:<digest>`: the first 16 base64url characters of the SHA-256
  of the model reference. A press finds the model among the configured ones of that moment and
  sets it for the `main` role with `model/set`; a digest that names none answers
  `cmd.ai.gone` and changes nothing.
- **What a pick replaces.** `model/set` takes only a configured model, else `protocol.bad_args`. The
  pick is kept in `agents.models` (`{ main?, fast?, vision? }`). Setting a role's own configured
  model clears the pick, so that role's fallbacks apply again. A picked model stands alone and is
  never swapped ([decision 0188](../DECISIONS.md#d0188)).
- **The runtime learns at once.** The settings gain `models.picked`, each agent's picks, read from
  the store at the engine's start. After each `model/set` the engine sends the runtime a
  `settings` line, which applies from the agent's next turn.
- **`choice` is the place** of the label in the question, `0` to `3`, as the button's callback data
  carries it.
- **Expiry at the first touch.** A question open for 24 hours is expired. The first call that
  meets it, a press, `chat/answer`, the owner's next message or the agent's next question, closes
  it with `expired` and edits its copies; until then its buttons stay, and a press on them says the
  question is closed and changes nothing.
- **`/schedules`** lists `schedule/list`; while the engine does not serve it, the reply says no
  schedule is set yet.

## Consequences

- An owner with one agent sees no change; with several, `/use` decides once, and each agent's
  words say whose they are.
- `/ai` works from a chat without the CLI, and the runtime needs no restart for a pick. A pick
  turns off that role's fallbacks until the owner picks the configured model again.
- A question's buttons may outlive its 24 hours on screen; a press then answers nothing.
- Spec 1 gains `model/list`'s `agent` and `current`; spec 3 gains `telegram_owner.agent_id`;
  spec 4 gains the `/ai` button, `/use`, and the command replies.

## Alternatives

- **The pick in memory only.** A restart would make the owner pick again, and a message in the
  meantime would be refused. Rejected.
- **The model reference in the callback data.** References of 60 characters exist, and a cut one
  could name another model. Rejected.
- **A place in the list as the button's data.** A config change between the reply and the press
  would pick another model. Rejected.
- **A timer that closes questions.** One more timer for edits the next touch makes anyway.
  Rejected.
- **The picked model in `turn/start`'s answer.** It would change the call every turn makes for a
  setting that changes rarely, while the runtime already takes settings lines. Rejected.
