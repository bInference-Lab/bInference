<p align="center">
  <img src=".github/assets/header.png" alt="bInference: your own AI agent, on BNB Smart Chain, in your pocket" width="100%">
</p>

<p align="center"><b>English</b> · <a href="README.zh.md">简体中文</a></p>

# bInference

bInference is an open-source AI agent for BNB Smart Chain. Deploy it as a trader, researcher, developer or anything you shape it into. It runs on your own machine, and you control it from Telegram and your other channels.

Hermes Agent, Meta's Muse and OpenClaw are AI agents for everyday life. bInference does what they do and is built for blockchain: it knows BNB Smart Chain inside out, so it trades, researches and acts there with a depth a general agent can't match.

**Your wallets, your rules, your tap.** The agent trades from its own wallets, inside limits you set. By default nothing moves until you tap; in auto mode it trades within your caps and tells you after.

[Website](https://binference.io) · [X](https://x.com/getbinference)

> [!IMPORTANT]
> bInference is in development and not ready for real funds.

## What it does

### Trade BSC launchpads <img src=".github/assets/logos/flap.png" width="18" height="18" alt="Flap">&nbsp;<img src=".github/assets/logos/genius.png" width="18" height="18" alt="Genius.fun">&nbsp;<img src=".github/assets/logos/brew.png" width="18" height="18" alt="Brew">

Launch your own token, catch new launches, trade the bonding curve and follow each token to its pool.

### Swap and automate <img src=".github/assets/logos/kyberswap.png" width="18" height="18" alt="KyberSwap">&nbsp;<img src=".github/assets/logos/okx.png" width="18" height="18" alt="OKX">

The best price across KyberSwap and OKX. Limit, take-profit, stop-loss, trailing stop, DCA and copy trading, run by code once you approve them; in this beta they fill on paper.

### Earn and bridge <img src=".github/assets/logos/lista.png" width="18" height="18" alt="Lista">&nbsp;<img src=".github/assets/logos/bnb.png" width="18" height="18" alt="BNB">&nbsp;<img src=".github/assets/logos/across.png" width="18" height="18" alt="Across">&nbsp;<img src=".github/assets/logos/relay.png" width="18" height="18" alt="Relay">

Stake BNB with a validator or for slisBNB on Lista, and bridge to other chains with Across and Relay.

### Research <img src=".github/assets/logos/x.png" width="18" height="18" alt="X">&nbsp;<img src=".github/assets/logos/web.png" width="18" height="18" alt="Any web page">

Reads X and any web page to explain a token, a narrative or a wallet before you decide. Cards show when an idea came from what it read.

### Market intelligence <img src=".github/assets/logos/dexscreener.png" width="18" height="18" alt="DEX Screener">&nbsp;<img src=".github/assets/logos/geckoterminal.png" width="18" height="18" alt="GeckoTerminal">

Prices, charts, liquidity and trending tokens from DEX Screener and GeckoTerminal, and new launches read on chain.

### Full chain access <img src=".github/assets/logos/bnb.png" width="18" height="18" alt="BNB Chain">&nbsp;<img src=".github/assets/logos/alchemy.png" width="18" height="18" alt="Alchemy">&nbsp;<img src=".github/assets/logos/quicknode.png" width="18" height="18" alt="QuickNode">&nbsp;<img src=".github/assets/logos/nodereal.png" width="18" height="18" alt="NodeReal">&nbsp;<img src=".github/assets/logos/ankr.png" width="18" height="18" alt="Ankr">&nbsp;<img src=".github/assets/logos/chainstack.png" width="18" height="18" alt="Chainstack">

Reads any contract, wallet or transaction on BSC through public BNB Chain RPCs, or your own Alchemy, QuickNode, NodeReal, Ankr or Chainstack key, with automatic failover.

### Custody agentic wallet <img src=".github/assets/logos/privy.png" width="18" height="18" alt="Privy">

The wallet key lives in Privy's secure enclave, never on your machine. The agent signs only inside a policy that you alone can change, and a lost machine loses nothing.

### Private execution <img src=".github/assets/logos/48club.png" width="18" height="18" alt="48 Club">&nbsp;<img src=".github/assets/logos/blockrazor.png" width="18" height="18" alt="BlockRazor">&nbsp;<img src=".github/assets/logos/pancakeswap.png" width="18" height="18" alt="PancakeSwap MEV Guard">

Every transaction is simulated first, then sent privately through 48 Club, BlockRazor or PancakeSwap MEV Guard, out of reach of front-running bots.

### Token safety <img src=".github/assets/logos/goplus.png" width="18" height="18" alt="GoPlus">&nbsp;<img src=".github/assets/logos/honeypot.png" width="18" height="18" alt="honeypot.is">

Before any buy of an unknown token, GoPlus, honeypot.is and its own buy-and-sell simulation catch honeypots, hidden taxes and owner tricks.

### Alerts and automation <img src=".github/assets/logos/tradingview.png" width="18" height="18" alt="TradingView">

Price and wallet alerts, scheduled check-ins ("review my portfolio every morning"), and TradingView alerts that fire your pre-approved orders, on paper in this beta.

### Portfolio

Positions, profit and loss at average cost, and a daily summary.

### Names and identity <img src=".github/assets/logos/spaceid.png" width="18" height="18" alt="SPACE ID">

Send to `.bnb` names, and register each agent on chain with ERC-8004.

### Learns how you trade

Remembers your strategy and notes, and adds the agent skills you install.

## Your machine, your control <img src=".github/assets/logos/telegram.png" width="20" height="20" alt="Telegram">&nbsp;<img src=".github/assets/logos/claude.png" width="20" height="20" alt="Claude Code">&nbsp;<img src=".github/assets/logos/codex.png" width="20" height="20" alt="Codex">&nbsp;<img src=".github/assets/logos/mcp.png" width="20" height="20" alt="MCP">

Run bInference on your own Mac with your own keys. The wallets are Privy wallets you own: no machine ever holds their keys, and a policy only you can change limits what any machine may sign. You talk to it on Telegram, in the web console (also inside Telegram as a Mini App), in the terminal, or from Claude Code, Codex and any MCP client.

Your agent has its own wallets and limits, and speaks English or Chinese. The bInference Router runs the AI by default; any compatible model provider works, local models included.

## Safe by design <img src=".github/assets/logos/safe.png" width="20" height="20" alt="">

- In manual mode, the default, every transaction arrives as a card with exact amounts, fees and a simulated result. One tap sends it; no answer means no.
- Auto mode trades within your caps and sends a receipt after each trade. Sends, bridges, token launches, buys of unverified or warned tokens and anything over a cap still ask.
- Limits hold even after a tap: per-trade and 24-hour caps, slippage and tax limits, and send levels that decide where funds may go.
- Sends go only to your rescue address or addresses you saved. Even with its keys stolen, a machine can only call the trading contracts you enabled, and can lose at most a 24-hour cap through them.
- Every new agent starts in paper mode, with virtual money and real quotes.
- `/freeze` in Telegram, or Freeze in the console, stops everything. `/rescue`, or the console's rescue card, moves your funds to your own wallet, but the BNB kept for network fees.

## Install <img src=".github/assets/logos/apple.png" width="20" height="20" alt="macOS">

bInference supports macOS for now; Linux and Windows come in later releases. In Terminal:

```bash
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

The script installs Node 26 when your Mac needs it, then bInference, then runs `binference init`, which sets it up. [Get started](apps/docs/src/content/docs/guides/getting-started.md) walks you from the setup to your first trade.

What each release changed for owners is in the [changelog](CHANGELOG.md).

The self-hosted agent charges no fees.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md): every change, by a person or a coding agent, follows them.

## Security

Report security problems privately through [GitHub security advisories](../../security/advisories/new), never in a public issue.

## License

[MIT](LICENSE)
