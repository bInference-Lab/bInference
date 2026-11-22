# 0450. The engine opens an agent's paper portfolio once, when it never had one

Status: Accepted

Accepted by the tech lead on 2026-11-22.

Amends [decision 0069](../DECISIONS.md#d0069).

## Context

Decision 0069 gives each agent's paper portfolio 1 BNB and 500 USDT, "changeable in onboarding,
resettable". `portfolio/resetPaper` opens the starting balances, `defaults.paper.balances`, in the
agent's first wallet, each valued at its USD price when it arrives. In the program that ships,
nothing calls it: only tests and the packed smokes did. A new agent's paper portfolio was empty, so
its first paper trade was refused.

Paper money moves only through the position store: a reset's arrivals, a paper fill's executions
and the positions both write. None of them is ever deleted, and a position stays as a row once it
holds nothing, so the store tells whether an agent ever had a paper portfolio.

## Decision

- **When.** A timer of the composition root runs the paper start once the engine serves, then
  every minute, locked or not.
- **Who.** Every agent not archived, live ones too, so `binference paper` finds a paper portfolio.
- **"Never had one."** None of the agent's wallets, archived ones included, holds a paper position
  (an empty one too), a paper arrival or a paper execution. No flag is stored.
- **How.** The paper portfolio's `start` opens the starting balances through the same positions
  reset `portfolio/resetPaper` runs, and tries once: a paper write that reached the wallet since
  its read makes it `stale`, which counts as started, and nothing is written.
- **Waiting.** An agent with no price for a starting balance, or with no wallet, waits for the next
  pass. The log names each start `engine.paper_started` and each agent that waits
  `engine.paper_start_waits`. The packed smokes wait for the first and reset nothing.
- **Onboarding.** Decision 0069's "changeable in onboarding" is not built: init asks nothing about
  paper balances, which change through `defaults.paper.balances`.

## Consequences

- A new install's agent holds the starting balances on paper once the chain's price feeds answer,
  and its first paper trade can fill.
- On an install made before, each agent with no paper record gets its start once; an agent with
  any paper record keeps what it holds, an emptied one too.
- Once every agent is done, a pass costs one read of the agents and the wallets a minute.

## Alternatives

- **Start it in `binference init`.** Init has no prices, and rebuilds, attaches and older installs
  would still hold agents with none.
- **A stored flag per agent.** A migration on both databases for what the store already tells.
- **Start it before the engine says it is ready.** Price reads would hold the start up.
