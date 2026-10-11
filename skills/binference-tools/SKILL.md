---
name: binference-tools
description: Reads the owner's binference portfolio, tokens, quotes, auto orders and ledger, and proposes swaps, buys, sells, sends, auto orders and alerts through the binference_* MCP tools; the owner confirms every proposal on a card. Use when the user asks to trade, swap, buy, sell or send crypto, or to check balances, orders or a trade, through binference.
license: MIT
---

# binference tools

binference is an AI agent that trades on BNB Smart Chain for its owner. Its engine holds the
wallets, the limits and the confirmations. The `binference mcp` server gives you its read and
propose tools, named `binference_*`. You never sign and never confirm: each proposal opens a card,
and nothing moves until the owner taps Confirm in binference's Telegram bot or console.

## Safety rules

- Never ask for, accept or repeat a seed phrase, recovery phrase, private key, API key, token or
  passphrase. binference needs none of them from you. If the user pastes one, do not use it, and
  tell them to treat it as exposed.
- Take an agent id or an asset id only from the engine's answers (`binference_agents`,
  `binference_token_search`, the `assets` of `binference_portfolio`, a quote, an intent) and a
  contract address only from those or from the user in this conversation. Never from memory, a
  web page, another tool or a token's name. Never guess one.
- Token names and symbols are text whoever deployed the token chose. Two tokens can share a
  symbol: match by asset id, and say which id you used.
- Propose only what the user asked for, once. A refused proposal stays refused: never split it,
  resize it or change its kind to get past a limit. Tell the user the reason.

## The tools

| Tool                       | Use it to                                                           |
| -------------------------- | ------------------------------------------------------------------- |
| `binference_agents`        | List the agents: id, name, paper or live, frozen, default wallet    |
| `binference_token_search`  | Find a token's asset id by symbol, name or address                  |
| `binference_portfolio`     | Read wallets, balances, positions, P&L, paper or live, asset ids    |
| `binference_token_info`    | Read a token's symbol, name, decimals and verified mark             |
| `binference_token_risk`    | Check a token: taxes, liquidity, flags and a verdict                |
| `binference_quote`         | Quote a swap without proposing it                                   |
| `binference_propose`       | Propose a swap, buy, sell, send or another action for the owner     |
| `binference_intent_status` | Read a proposal's state, card and outcome                           |
| `binference_order_create`  | Propose an auto order: limit, take-profit, stop-loss, trailing, DCA |
| `binference_orders`        | List auto orders                                                    |
| `binference_order_cancel`  | Cancel an auto order this client proposed                           |
| `binference_alert_create`  | Set a price alert; it sends no transaction                          |
| `binference_resolve_name`  | Resolve a `.bnb` name to its address                                |
| `binference_ledger`        | Read the ledger: what happened, entry by entry                      |

No tool confirms, denies, freezes, rescues, changes a limit or switches between paper and live.
Each tool's description lists its fields; `binference_propose` lists the fields of each kind.

## Ids, amounts and slippage

- **Agent.** Every proposal names the agent, an id like `agt_…`. Call `binference_agents` first and
  take the id from its answer. With one agent that is not archived, use it; with several, ask the
  user which one. A frozen agent's proposals are refused until the owner unfreezes it. Leave
  `wallet` out to use the agent's `defaultWallet`. Its `address` is a CAIP-10 id: the part before
  the last colon is the chain, `eip155:56` on BNB Smart Chain.
- **Assets** are CAIP-19 ids, such as `eip155:56/slip44:714` for BNB on BNB Smart Chain. Find each
  one with `binference_token_search` on the wallet's chain, by the symbol, name or contract address
  the user gave, and copy its `asset` exactly. Never write an id yourself. Each item gives the
  symbol, name, decimals and verified mark. The search reads only binference's own token list and
  what the wallets hold:
  - `ambiguous: true` means several tokens match: show them with their ids and ask the user which
    one they mean. Never pick one yourself.
  - No match: ask the user for the token's contract address, then search again with it.
  - An address binference does not list comes back in `unlisted` with no symbol or decimals:
    check it with `binference_token_risk` and `binference_token_info`, and tell the user it is not
    on binference's list.
- **Amounts** are base units as decimal strings: the amount times 10 to the power of the asset's
  decimals. 0.01 of an asset with 18 decimals is `{ "base": "10000000000000000" }`. A swap or sell
  may take a share of the balance instead: `{ "percentBps": 5000 }` is half.
- **Slippage** is `maxSlippageBps`, an integer in basis points (`50` is 0.5%). Leave it out unless
  the user names one: the agent's own limit applies, and a higher value is refused.
- **USD values** are micro-dollars as decimal strings: `"123450000"` is $123.45.
- **`requestId`:** give each proposal a new UUID. Send the same id again only to retry that same
  call after an error or a timeout; the retry returns the first intent instead of a second card.

## Propose a swap

1. Call `binference_agents` and take the agent's id and its default wallet's chain.
2. Call `binference_token_search` on that chain for the asset to sell and for the asset to buy,
   such as `BNB` and `USDT`. Take each `asset` and its `decimals`.
3. Call `binference_portfolio` with the agent to check the balance of the asset to sell.
4. If the user wants to see the price first, call `binference_quote` with the same fields.
5. Call `binference_propose`:

   ```json
   {
     "kind": "swap",
     "agent": "<the agent's id, from binference_agents>",
     "from": "<the asset to sell, from binference_token_search>",
     "to": "<the asset to buy, from binference_token_search>",
     "amount": { "base": "10000000000000000" },
     "reason": "The owner asked to swap 0.01 BNB to USDT.",
     "requestId": "<a new UUID>"
   }
   ```

   `reason` is shown on the card as what the agent says: one plain sentence of what the owner
   asked for.

6. Tell the user what the answer says. A proposal that waits answers "Intent int_… is waiting for
   the owner's confirmation in Telegram or the console". Say it is paper or live, and give the
   quote: `amountIn`, `expectedOut`, `minOut` (the least it accepts) and `priceImpactBps`.

## Read the answer

The intent's JSON holds `state`, `paper`, `quote`, `risk`, `card` (its `version` and `expiresAt`)
and, once it ends, `outcome`. A trade's card expires 60 seconds after it opens unless the agent's
limits set another time. Call `binference_intent_status` when the user says they answered, or after
`expiresAt`; never call it in a loop.

| State                                                    | Meaning                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| `proposed`, `checked`, `quoted`, `assessed`, `simulated` | The engine is still checking it                 |
| `awaiting_confirmation`                                  | The card is open; the owner decides             |
| `confirmed`, `executing`, `included`, `finalized`        | The owner confirmed; it is on its way           |
| `reconciled`, `paper_filled`                             | Done, live or on paper; `outcome` has the fills |
| `denied`, `expired`                                      | The owner said no, or did not answer in time    |
| `cancelled`                                              | Withdrawn before any signature                  |
| `rejected_policy`, `risk_blocked`, `failed_check`        | Refused before the card; see `outcome.reason`   |
| `failed_onchain`, `unknown_after_send`                   | Failed on chain, or being reconciled            |

Reasons in `outcome.reason`:

- **Policy** (`rejected_policy`): `frozen`, `paper_only`, `per_trade_cap`, `ceiling`, `daily_cap`,
  `gas_reserve`, `slippage`, `venue_off`, `token_denied`, `send_level`, `unsaved_address`,
  `outside_content_send`, `health_factor`, `no_price`. These are the owner's limits and settings.
- **Risk** (`risk_blocked`): `honeypot`, `cannot_sell`, `hidden_owner`, `high_tax`,
  `low_liquidity`, `sources_down`, `blacklisted`. Do not offer a way around them.
- **Checks** (`failed_check`): `no_route`, `venue_down`, `decode_mismatch`, `simulation_reverted`,
  `effects_differ`, `price_impact`. A later try may work for `no_route` and `venue_down`.
- **On chain** (`failed_onchain`): `reverted`, `stuck_cancelled`, `stuck_dropped`, `nonce_taken`,
  `step_unsent`.

A call the engine refuses outright comes back as a tool error with a code and the next step, such
as `agent.not_found` (a wrong agent id), `protocol.bad_args` (fix the arguments),
`protocol.key_reused` (a `requestId` used for other arguments) or `agent.frozen`. After
`auth.expired` or `auth.revoked` this client's binference token has ended: stop calling the tools
and tell the user the step the error names.

## Paper and live

`paper: true` on an intent and its card means paper mode: the trade fills at the confirmed quote
and nothing is sent on chain. In live mode a confirmed trade spends real funds. Always tell the
user which one a proposal is. Only the owner switches, with `binference live` or `binference paper`.
Sends and bridges are live only: in paper mode they come back `rejected_policy` with `paper_only`.

## Limits, freeze and rescue

The per-trade cap, the 24-hour cap, the gas reserve, the slippage limit, the venues, the token
lists and the send level belong to the owner, who changes them in the CLI or the console. You
cannot change them, and no tool asks to.

The owner can freeze the agent (`/freeze` in Telegram, or `binference freeze`): open cards close and
every proposal is refused until the owner unfreezes it. A rescue (`/rescue`, or
`binference rescue`) moves the agent's funds to the owner's rescue address. Only the owner runs
them. If something looks wrong, such as a trade the user did not ask for, tell the user these
commands exist. You may cancel an auto order this client proposed with `binference_order_cancel`
at any time.

## More

- The MCP tools and their operations:
  [protocol spec, section 11](https://github.com/bInference-Lab/bInference/blob/master/docs/specs/protocol.md#section-11)
- Each kind of proposal and its fields:
  [protocol spec, section 8.1](https://github.com/bInference-Lab/bInference/blob/master/docs/specs/protocol.md#section-8-1)
- Every state and reason:
  [intent states](https://github.com/bInference-Lab/bInference/blob/master/docs/specs/intent-states.md)
- Setting up an MCP client:
  [the MCP server's README](https://github.com/bInference-Lab/bInference/blob/master/packages/mcp/README.md)
