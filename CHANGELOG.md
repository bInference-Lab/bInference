<p><b>English</b> · <a href="CHANGELOG.zh.md">简体中文</a></p>

# Changelog

What changed for owners in each release of binference, newest first.

## 2026.11.0-beta.1

The first public beta, for macOS. Install it with
`curl -fsSL https://binference.io/install.sh | sh -s -- --beta`.

What it does:

- An AI agent that trades on BNB Smart Chain for you, from your Mac. Talk to it in Telegram, the
  web console or the terminal chat that `binference chat` opens.
- It starts in paper mode: real quotes, checks and cards, with no funds moved. Its paper portfolio
  starts with 1 BNB and 500 USDT.
- In the default manual mode, every trade comes as a card with its exact terms, and nothing moves
  until you confirm it.
- Run `binference live` in Terminal to trade real money from the agent's wallet, and
  `binference paper` or `/paper` to switch back.
- `/freeze` or `binference freeze` stops everything at once. `/rescue` or `binference rescue`
  moves every agent wallet's funds to your rescue address once you confirm its card, keeping
  0.002 BNB for network fees.
- Your wallets stay in Privy under a ceiling only your owner key can change.

Known limits:

- macOS only. The install script stops on any other system; Linux and Windows come in later
  releases.
- Auto orders and webhook rules fill on paper only.
- No Docker image.
