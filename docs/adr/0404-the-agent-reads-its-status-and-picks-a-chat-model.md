# 0404. The agent reads its status and picks a chat model

Status: Accepted

Accepted by the tech lead on 2026-11-08.

## Context

The owner asks the agent which model it runs on, how much of today's model budget is left, how
long the chat has run or what its helpers do. The agent sees part of it in each call's live facts
(decision 0395) but has no single read of it, so it answers from memory or guesses. The owner also
asks it to switch models for one task ("use the big model for this research"), and the only way
today is a settings change, which needs a card and changes every chat (decision 0393).

The facts come from three owners: the engine (agent, mode, freeze, approval mode, model spend and
budget), the runtime's settings (the models in force) and `agent.sqlite` (the session, its turns,
the helpers). The runtime holds no money state, so a model of the chat's own must stay under the
agent's daily model budget, which the engine enforces on every model call.

## Decision

- **`agent_status`** is a read tool. Its one answer, within the 12,000 characters of a tool result,
  names: the agent, its name and id, paper or live, frozen or not, its approval mode (`facts/get`
  and `agent/get`); the models in force: main (and the chat's own model when one is set), fast,
  vision and image making, from the runtime's settings; today's model spend, the daily budget,
  what is left and when it resets at the owner's next midnight (`usage/get`, else the budget left
  the engine last answered); this chat: when it started, its turns so far, the model this turn
  calls now, roughly how much of the context window the next call fills, and whether the turn is
  marked as outside content; the agent's helpers, how many run and their labels; binference's
  version and the time now in the owner's timezone. A part the engine does not answer is said to be
  missing. Everything in it is binference's own, so it is never outside content.
- **Chat model.** In the agent's own turns, `agent_status` takes an optional `model`,
  `<provider>/<model>` of a provider `models.providers` configures, the check a helper's model
  passes. It sets the main model for the rest of the session, kept in `sessions.model` (agent
  migration 0007); `default` clears it. The next turn runs on it alone, with no fallbacks, as a
  model the owner picked for the agent does (decision 0204), and it wins over that pick inside this
  chat. It changes nothing in `config.json5`, needs no card, and the agent's daily model budget
  still caps what it spends. A clear (`chat/clear`) starts a session with no model of its own. A
  chat model whose provider the settings no longer configure is ignored: the turn runs on the
  configured chain, and `agent_status` says so.
- **Helpers** may read `agent_status`, about their own session, and never set a model: the tool a
  helper's turn gets takes no arguments, and the agent's own declares that no helper calls it. A
  helper keeps its own model rule (decision 0403).
- The tool's description tells the agent to set a chat model only when the owner asks for one, to
  name the model as `agent_status` or `settings_read` answers it, and to answer questions about its
  model, budget or chat from it.
- The loop hands every tool where its turn stands (the model it calls now, its outside mark and
  its context estimate), so the tool reads them without the loop knowing its name.

## Consequences

- The agent answers questions about itself from one read, in the owner's timezone, instead of
  from memory.
- The owner can have one chat run on another model without a card or a settings change, and the
  next chat is back on the configured one.
- A model the owner never priced counts at the provider's reported cost or $0 under the budget,
  as a helper's model does today.
- `SessionStore` gains `setModel` and `countTurns`, with their contract checks on SQLite, memory
  and Postgres.

## Alternatives

- **A settings change** (`settings_change` of `models.main`): changes every chat and needs a card
  for a choice that lasts one task.
- **A model kept in runtime memory only**: lost at each runtime start, so a chat would switch back
  without anyone asking.
- **A separate tool for the switch**: two tools for one question the owner asks; a helper's
  read-only variant of the same tool keeps the switch out of its reach.
