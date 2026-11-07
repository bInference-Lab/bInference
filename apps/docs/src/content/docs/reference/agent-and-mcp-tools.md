---
title: "Agent and MCP tools"
description: "The tools the agent's model calls, and the tools binference mcp serves to MCP clients."
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

## Agent tools

The tools the agent's model may call in a turn, in the order a turn offers them. A read only reads, a proposal opens a card the owner confirms, and a control tool sets an alert or a schedule, saves a note or asks the owner. The web tools need a search key, and `search_x` an X key. Each enabled community plugin adds its own tools.

- `token_search` (read): Finds a token's id by its symbol, name or contract address.
- `addresses` (read): Reads the owner's address book for this agent.
- `wallets` (read): Reads the agent's own wallets: each one's role, chain and address, and its mode.
- `portfolio` (read): Reads the agent's balances, positions and profit and loss.
- `token_info` (read): Reads a token's symbol, name, decimals and last risk check.
- `token_risk` (read): Checks a token for a honeypot, its tax and its liquidity.
- `quote` (read): Quotes a swap without proposing it.
- `bridge_quote` (read): Quotes a bridge to another chain without proposing it.
- `staking_options` (read): Lists the validators and pools the agent may stake with, and its stakes.
- `orders` (read): Lists the agent's auto orders.
- `tx_status` (read): Reads one proposal's state, card and transactions.
- `market_scan` (read): Lists new launches or trending tokens on a chain.
- `chart` (read): Reads a token's price candles.
- `wallet_activity` (read): Reads the trades of a wallet the agent tracks.
- `schedule_list` (read): Lists the agent's schedules.
- `search_web` (read): Searches the web.
- `read_page` (read): Reads one public web page.
- `search_x` (read): Searches recent posts on X.
- `look_at_image` (read): Looks at a picture at a public address or in a file on the owner's machine and describes it.
- `notes_search` (read): Searches the agent's notes.
- `notes_get` (read): Reads one of the agent's notes in full.
- `open_skill` (read): Opens one of the agent's skills.
- `swap` (proposal): Proposes a swap of one token for another.
- `buy` (proposal): Proposes a buy of a token.
- `sell` (proposal): Proposes a sale of a token.
- `send` (proposal): Proposes a send to a saved address, the rescue address or a .bnb name.
- `approval_revoke` (proposal): Proposes setting a token approval back to zero.
- `order_create` (proposal): Proposes an auto order.
- `stake` (proposal): Proposes a stake with a validator or in a pool.
- `unstake` (proposal): Proposes an unstake.
- `claim` (proposal): Proposes a claim of what the venue lets the wallet take back.
- `bridge` (proposal): Proposes a bridge to another chain.
- `order_cancel` (control): Cancels an auto order at once.
- `alert_create` (control): Sets a price, wallet or launch alert at once.
- `schedule_create` (control): Sets a schedule that starts a turn at its time.
- `schedule_cancel` (control): Cancels a schedule.
- `notes_write` (control): Saves a note to the agent's memory.
- `notes_forget` (control): Forgets one of the agent's notes.
- `workspace_write` (control): Saves the owner's strategy or the agent's persona.
- `first_chat_end` (control): Ends the first chat once the owner's answers are saved.
- `launchpads` (read): Lists the launchpads on a chain and their settings.
- `launch_draft` (control): Drafts a token launch that only the owner can start.
- `deposit_address` (control): Shows the owner each wallet's address and its QR code, to send funds to the agent.
- `show_chart` (control): Shows the owner a pie, bar, area or line chart in the chat, or its text where no chart is drawn.
- `make_image` (control): Makes images with the owner's image model, such as a token's logo; they arrive in the chat a little later.
- `shell` (machine): Runs a command on the owner's machine, away from binference's own files, and reads its output.
- `shell_job` (machine): Reads a running command's new output, or stops it.
- `file_read` (read): Reads a text file on the owner's machine, a page at a time, or describes an image file.
- `file_write` (machine): Writes a file whole on the owner's machine, making its folders.
- `file_edit` (machine): Makes exact replacements in a file on the owner's machine.
- `file_patch` (machine): Changes several files in one patch, by default inside the agent's workspace.
- `credentials` (control): Lists the owner's stored credentials, asks the owner for a missing one in a masked prompt, or removes one.
- `ask_owner` (control): Asks the owner a question with answer buttons.

## MCP tools

The tools `binference mcp` serves to MCP clients, each calling one engine operation. An MCP client holds only the read and propose scopes, so no tool can confirm. A tool that takes a request id returns the first card again when a call is retried with the same id.

| Tool | What it does | Operation | Takes a request id |
| --- | --- | --- | --- |
| `binference_agents` | Lists the owner's agents and their wallets. | `agent/list` | no |
| `binference_token_search` | Finds a token's id by its symbol, name or contract address. | `asset/search` | no |
| `binference_addresses` | Reads an agent's address book. | `address/list` | no |
| `binference_wallets` | Reads an agent's own wallets with their roles and addresses. | `wallet/list` | no |
| `binference_portfolio` | Reads an agent's balances, positions and profit and loss. | `portfolio/get` | no |
| `binference_token_info` | Reads a token's symbol, name, decimals and last risk check. | `asset/get` | no |
| `binference_token_risk` | Checks a token for a honeypot, its tax and its liquidity. | `risk/check` | no |
| `binference_quote` | Quotes a swap without proposing it. | `quote/get` | no |
| `binference_bridge_quote` | Quotes a bridge to another chain without proposing it. | `bridge/quote` | no |
| `binference_staking_options` | Lists the validators and pools an agent may stake with. | `staking/options` | no |
| `binference_orders` | Lists an agent's auto orders. | `order/list` | no |
| `binference_resolve_name` | Reads the address a .bnb name points to. | `name/resolve` | no |
| `binference_propose` | Proposes a trade, send, bridge or stake, which opens a card. | `intent/propose` | yes |
| `binference_intent_status` | Reads one proposal's state, card and transactions. | `intent/get` | no |
| `binference_order_create` | Proposes an auto order, which opens a card. | `order/create` | yes |
| `binference_order_cancel` | Cancels an auto order. | `order/cancel` | no |
| `binference_alert_create` | Sets a price, wallet or launch alert. | `alert/create` | no |
| `binference_ledger` | Reads an agent's ledger. | `ledger/list` | no |
