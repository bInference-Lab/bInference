---
title: "Commands"
description: "Every binference command, with its arguments and options."
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

Every command of `binference`, with its arguments and options, as its help shows them. Run `binference <command> --help` for the same text in the terminal. Every command also takes these options:

- `--json`: Print JSON for scripts instead of text.
- `--yes`: Answer yes to every question.
- `-h, --help`: Show help for a command.

## `binference init`

Set up binference: your Privy app, your owner key, your first wallet and your bot.

Options:

- `--privy-app-id <id>`: Your Privy app ID.
- `--privy-app-secret <source>`: The Privy app secret's source, written as in config.json5.
- `--bot-token <source>`: The bot token's source, written as in config.json5.
- `--rescue <address>`: Your rescue address on BNB Chain.
- `--owner-key-public <key>`: The owner key's public half that `binference owner-key create` printed; init then makes no owner key.
- `--unlock <mode>`: Where this machine keeps the agent key: `keychain`, `file`, `manual` or `command`. One of `keychain`, `file`, `manual`, `command`.
- `--unlock-command <source>`: With --unlock command: the program that prints the agent key, written as in config.json5.
- `--model-provider <provider>`: The model provider: `binference`, `openai`, `anthropic`, `openrouter`, `openai-compatible` or `anthropic-compatible`.
- `--model-base-url <url>`: With a compatible provider: its API address.
- `--model <id>`: The model's ID at the provider.
- `--model-key <source>`: The provider key's source, written as in config.json5.
- `--proxy <url-or-source>`: Your proxy, as a secret source written as in config.json5; init's checks go through it, and init writes it to config.json5.
- `--accept-disclaimer`: With nobody at the terminal: print the disclaimer and the privacy statement in full, and accept them.
- `--answers <file>`: A JSON5 file of answers by flag name in camel case, each secret as a secret source.
- `--set <key=value>`: Set a config key in the file init writes, written as `key=value`.
- `--start-over`: Set up a folder set up before again, with a new owner key and a new wallet.
- `--attach`: Make this machine the signer of the install's wallets with a new agent key and the owner key; the key it replaces signs nothing more.
- `--restore <file>`: With --attach: restore this backup file first, opened with the owner key.

## `binference start`

Start the engine as a background service, which starts again each time you log in.

Options:

- `--set <key=value>`: Set a config key for this run, written as `key=value`.
- `--foreground`: Run the engine in this terminal until you press Ctrl+C, as the background service runs it.

## `binference restart`

Stop the engine, then start it again as the background service.

Options:

- `--set <key=value>`: Set a config key for this run, written as `key=value`.

## `binference status`

Show whether the engine runs, its agents and its health signals.

## `binference health`

Check that the engine runs and is ready.

## `binference stop`

Stop the engine; the background service starts it again when you log in.

## `binference console`

Make a single-use link that pairs a browser with the console.

## `binference report`

Write a support bundle to share: versions, config, checks and the newest log lines, with no secret.

## `binference unlock`

Open the agent key so binference can sign; asks for the passphrase in the manual unlock mode.

## `binference logs`

Show the engine's log.

Options:

- `-n, --lines <count>`: How many of the last lines to show.
- `-f, --follow`: Keep showing new lines until you press Ctrl+C.

## `binference approval`

Show the agent's approval mode, or set it to manual or auto.

Arguments:

- `[mode]`: The approval mode to set: manual or auto. One of `manual`, `auto`.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

## `binference chat`

Chat with an agent in the terminal: its answers, cards, questions and notices.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

## `binference live`

Switch the agent to live: its trades use real money from its wallet.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

## `binference paper`

Switch the agent back to paper mode, where nothing is sent on chain.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

## `binference agent`

Commands on one agent: its on-chain identity.

### `binference agent identity`

Show the agent's on-chain identity, or opt it in with the owner key and open the card that registers it.

Options:

- `--description <text>`: A few words about the agent, published on chain for good; 1 to 280 characters.
- `--agent <id>`: The agent's id; the only agent when left out.

## `binference confirm`

Confirm the card of an intent, as its Confirm button does.

Arguments:

- `<intent>`: The intent's id, starting with int_. Required.

## `binference deny`

Cancel the card of an intent, as its Cancel button does.

Arguments:

- `<intent>`: The intent's id, starting with int_. Required.

## `binference wallet`

List the agent wallets and show the address to fund.

### `binference wallet list`

List the agent wallets, each with its label and address.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

### `binference wallet address`

Show the address to fund the agent's default wallet at.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.
- `--wallet <id>`: The wallet's id; the agent's default wallet when left out.

### `binference wallet export`

Show a wallet's private key once, after a warning; asks for the owner key.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.
- `--wallet <id>`: The wallet's id; the agent's default wallet when left out.

### `binference wallet create`

Make a new agent wallet under a ceiling of its own; asks for the owner key.

Options:

- `--label <text>`: A name for the wallet, such as savings. Required.
- `--launch`: Make the agent's launch wallet, the one wallet that trades on a launch's own curve.
- `--bridge`: Make the agent's bridge wallet, the one wallet that deposits into a bridge whose deposit names no recipient, such as Relay.
- `--agent <id>`: The agent's id; the only agent when left out.

## `binference ceiling`

Show a wallet's ceiling as custody holds it: its chains, venues, cap, the addresses a send may pay and the 24-hour caps.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.
- `--wallet <id>`: The wallet's id; the agent's default wallet when left out.

### `binference ceiling set`

Change, with the owner key, the venues a contract call may use and the most it may carry on every wallet of the agent, or the 24-hour caps every wallet shares.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.
- `--wallet <id>`: The wallet's id; the agent's default wallet when left out.
- `--venues <ids>`: Every venue a contract call may use, separated by commas, such as kyberswap,okx.
- `--per-tx <amount>`: The most native coin one contract call may carry, such as 0.5.
- `--day-cap-usd <dollars>`: The size of every 24-hour cap in US dollars at its floor price, such as 2000.

## `binference freeze`

Freeze every agent and the install, or the agent --agent names: their open cards and unsigned actions are cancelled.

Options:

- `--agent <id>`: The agent's id; every agent and the install when left out.

## `binference unfreeze`

Open the card that unfreezes every frozen agent, or the agent --agent names; confirming it unfreezes.

Options:

- `--agent <id>`: The agent's id; every agent and the install when left out.

## `binference rescue`

Open the rescue card: it moves everything in every agent wallet to your rescue address.

### `binference rescue set`

Make an address the rescue address in 24 hours; asks for the owner key.

Arguments:

- `<address>`: Your own wallet's address on BNB Chain, starting with 0x. Required.

### `binference rescue cancel`

Cancel a rescue address change that waits; the rescue address in effect stays.

## `binference safety`

Show what is frozen, the rescue under way and the rescue address.

### `binference safety status`

Show what is frozen, the rescue under way and the rescue address.

## `binference telegram`

Pair the owner's Telegram bot with another account.

### `binference telegram pair`

Make a new link that pairs another Telegram account with the bot; the current owner stays until it is opened.

## `binference backup`

Make and list backups of the install.

### `binference backup create`

Make a backup now, sealed to the owner key and kept until you remove it.

### `binference backup list`

List the backups, newest first.

### `binference backup restore`

Restore a backup of this install: stops binference, puts the backup in place and starts binference again as it ran.

Arguments:

- `<file>`: The backup file, a .bnfbak. Required.

Options:

- `--set <key=value>`: Set a config key for this run, written as `key=value`.

## `binference signer`

Manage the machines whose agent keys sign for the wallets.

### `binference signer revoke`

Remove a machine's agent key from every wallet; asks for the owner key.

Arguments:

- `<signer>`: The signer ID: the key quorum of the machine's agent key, as `binference init --attach` printed it. Required.

## `binference owner-key`

Make an owner key on a machine with a terminal, for an install set up without one.

### `binference owner-key create`

Make an owner key, show its code once in this terminal, and print its public half.

## `binference service`

Manage the background service that starts binference when you log in.

### `binference service remove`

Stop binference and remove its background service from this machine; the state folder stays.

## `binference address`

List, save and remove the addresses a send may pay.

### `binference address list`

List the agent's saved addresses, each with when a send may pay it.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

### `binference address add`

Save an address a send on its chain, or a bridge to it, may pay, in the address book and the wallets' ceilings; asks for the owner key.

Arguments:

- `<address>`: The address as its chain writes it: 0x and 40 hex digits on an EVM chain, base58 on Solana. Required.

Options:

- `--label <text>`: A name for the address, such as cold wallet. Required.
- `--chain <key>`: The chain the address is on, by its name in the registry, such as base-mainnet or solana; BNB Smart Chain when left out.
- `--agent <id>`: The agent's id; the only agent when left out.

### `binference address remove`

Remove a saved address: binference sends nothing to it from then on.

Arguments:

- `<entry>`: The address book entry's id, starting with adr_. Required.

## `binference webhook`

Make, list, rotate and delete alert rules: a rule fills on paper inside its bounds each time an alert reaches its URL.

### `binference webhook list`

List the alert rules that are active or wait for their card.

### `binference webhook create`

Make an alert rule with its bounds, show its URL once, then show its card to confirm.

Options:

- `--name <text>`: The alert's name, shown on the rule's card, 1 to 64 characters. Required.
- `--token <token>`: The token each alert trades: its symbol, such as CAKE, or its address. Required.
- `--side <side>`: Whether each alert buys or sells the token. Required. One of `buy`, `sell`.
- `--usd <dollars>`: Each fill's size in dollars, such as 20.
- `--amount <amount>`: Each fill's size as an amount, such as 0.5: of what a buy spends, or of the token a sale sells.
- `--percent <percent>`: Each fill's size as a percent of the balance, such as 25: of what a buy spends, or of the token a sale sells.
- `--spend <token>`: What a buy spends: a symbol or an address; the chain's coin when left out.
- `--worst-price <dollars>`: The worst price a fill takes, in dollars per token; no worst price when left out.
- `--slippage <percent>`: The most slippage a fill takes, in percent, such as 0.5; the agent's limit when left out.
- `--max-fills <count>`: The most fills before the rule ends; no limit when left out.
- `--rate <count>`: The alerts the rule takes in a minute, 1 to 60; 1 when left out.
- `--ttl <duration>`: How long the rule lasts, such as 7d, up to 365d; 30 days when left out.
- `--agent <id>`: The agent's id; the only agent when left out.
- `--wallet <id>`: The wallet's id; the agent's default wallet when left out.

### `binference webhook events`

List the alerts a rule's URL took and what each became, newest first.

Arguments:

- `<rule>`: The alert rule's id, starting with whr_, as `binference webhook list` shows it. Required.

Options:

- `--before <event>`: Show the alerts older than this one, by the number the list shows.

### `binference webhook rotate`

Give an alert rule a new URL, shown once; the old one no longer works from then on.

Arguments:

- `<rule>`: The alert rule's id, starting with whr_, as `binference webhook list` shows it. Required.

### `binference webhook delete`

Delete an alert rule; its URL no longer works from then on.

Arguments:

- `<rule>`: The alert rule's id, starting with whr_, as `binference webhook list` shows it. Required.

## `binference credential`

List, store and delete the credentials the agent asks for, which it never sees.

### `binference credential list`

List the stored credentials by name, with the hosts each may be sent to.

### `binference credential set`

Store a credential, typed at a masked prompt, and the hosts it may be sent to.

Arguments:

- `<name>`: The credential's name, such as DUNE_API_KEY. Required.

Options:

- `--allow-host <host>`: A host the credential may be sent to, such as api.dune.com; repeat for more.

### `binference credential delete`

Delete a stored credential.

Arguments:

- `<name>`: The credential's name, such as DUNE_API_KEY. Required.

## `binference plugin`

Add, list, enable, disable and remove community plugins.

### `binference plugin add`

Add a community plugin from npm, or update one, after its permission review.

Arguments:

- `<source>`: the plugin's npm package at an exact version, such as npm:fear-index@1.2.0. Required.

Options:

- `--hash <integrity>`: the version's npm integrity (sha512-...); read from npm when left out.
- `--name <name>`: the plugin's name, typed for a plugin without npm provenance.

### `binference plugin list`

List the installed community plugins.

### `binference plugin enable`

Enable an installed plugin.

Arguments:

- `<name>`: the plugin's name, as `binference plugin list` shows it. Required.

### `binference plugin disable`

Disable an installed plugin at once.

Arguments:

- `<name>`: the plugin's name, as `binference plugin list` shows it. Required.

### `binference plugin remove`

Remove an installed plugin and its data.

Arguments:

- `<name>`: the plugin's name, as `binference plugin list` shows it. Required.

## `binference limit`

Show the agent's limits in effect, and the looser ones that wait.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

### `binference limit set`

Change the agent's limits, each as `key=value`: a stricter one applies at once, a looser one in 24 hours.

Arguments:

- `<sets...>`: Each limit as `key=value`, named and in the units `defaults` uses in config.json5, such as limits.perTradeUsd=50. Required.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

### `binference limit cancel`

Drop the looser limits that wait; the limits in effect stay.

Options:

- `--agent <id>`: The agent's id; the only agent when left out.

## `binference config`

Show and change the config in config.json5.

### `binference config get`

Show the config as it loads, or one key of it, with every secret shown as its source's kind.

Arguments:

- `[key]`: The config key, its parts joined with dots, such as `engine.port`.

### `binference config set`

Change one config key in config.json5 through the engine, keeping the file's comments.

Arguments:

- `<key>`: The config key, its parts joined with dots, such as `engine.port`. Required.
- `[value]`: The value, read as JSON5 (7460, true, "text", [1, 2], or null to remove the config key), else as text.

Options:

- `--from-env <variable>`: Set the key to the secret source that reads this environment variable.
- `--from-keychain <name>`: Set the key to the secret source that reads this keychain entry.
- `--from-credential <name>`: Set the key to the secret source that reads this credential stored in the engine.
- `--reason <text>`: Why, for the config journal.

## `binference mcp`

Serve the MCP tools to an MCP client over stdio; the client starts it.

Options:

- `--client <name>`: The MCP client whose client token to sign in with: claude-code or codex. One of `claude-code`, `codex`.

### `binference mcp setup`

Set up an MCP client: its own client token, its MCP server entry and the binference-tools skill.

Options:

- `--client <name>`: The MCP client to set up: claude-code or codex. Required. One of `claude-code`, `codex`.
- `--dry-run`: Show the changes and make none.
- `--remove`: Undo the setup: remove the MCP server entry and the skill, and revoke the client token.
- `--ttl <duration>`: Make a new client token that expires after this long: 30m, 12h or 7d, at most 90d. Without it the client token does not expire.

### `binference mcp session`

Start Claude Code or Codex once with the binference tools and a client token that ends with the session.

Arguments:

- `[clientArgs...]`: Arguments for the client, after --.

Options:

- `--client <name>`: The MCP client to start: claude-code or codex. Required. One of `claude-code`, `codex`.
- `--ttl <duration>`: How long the session's client token works: 30m, 2h or 1d, at most 24h; 1h when left out.
- `--print-config`: Print the config and the client token for a client you start yourself, and start nothing.

## `binference check`

Check this install: its config, who can open its files, its unlock mode and the engine.

Options:

- `--fix`: Fix what the check may fix: make files and folders others can open yours alone.

## `binference reset`

Clear the agents' chats, notes and caches after a sealed backup; wallets, keys, limits, orders and history stay.

Options:

- `--set <key=value>`: Set a config key for this run, written as `key=value`.

## `binference expose`

Publish the Mini App inside your tailnet over Tailscale, and with --webhooks the path alert rules receive alerts on.

Options:

- `--webhooks`: Also publish the path alert rules receive alerts on to the internet, over Tailscale Funnel; it asks first.
- `--off`: Take off what binference published over Tailscale; everything else Tailscale serves stays.

## `binference update`

Install a newer binference release from npm, check it, and put the old one back if its check fails.

Options:

- `--to <version>`: The release to install, such as 2026.11.0; the newest on updates.channel when left out.
- `--set <key=value>`: Set a config key for this run, written as `key=value`.

## `binference uninstall`

Remove binference's background service and the program; with --state, its state folder too.

Options:

- `--state`: Also remove the state folder: the config, the databases, the keys, the logs and the backups in it.
