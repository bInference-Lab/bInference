<p><b>English</b> · <a href="CHANGELOG.zh.md">简体中文</a></p>

# Changelog

What changed for owners in each release of binference, newest first.

## 2026.11.0-beta.2

Bridges, and fixes from the first week of the beta.

What it does:

- Your agent bridges USDC, USDT and ETH from BNB Smart Chain to Ethereum, Base, Arbitrum, Solana
  and Robinhood Chain. It quotes Across and Relay at once and takes the route that pays the most.
- A bridge pays only addresses you saved with your owner key, or your rescue address where it may
  pay it. The card shows the recipient, the least that arrives, the fees and the time, and the
  share the fees take once it reaches 1%. binference reads the other chain and tells you when the
  funds arrive.
- New agents can bridge through Across at once. Relay bridges leave from a bridge wallet you make
  with `binference wallet create --bridge` and fund yourself.
- Adding a bridge venue to an agent's venues applies at once, and a bridge pays an address the
  moment you save it.
- Your agent no longer repeats a trade's receipt after it settles. An idle engine uses less memory.

Fixed:

- Wallet commands failed with "the wallet service is not responding" after
  `binference init --start-over`.
- The agent searched for a bridge's token on the other chain and stopped without proposing it.

Known limits:

- An agent made with 2026.11.0-beta.1 has no bridge venue: add `across` with
  `binference ceiling set --venues` and `binference limit set limits.venues=`, as the bridges
  guide shows.
- On Base, Ethereum and Arbitrum, binference books a bridge as arrived only once that chain
  finalized the block, which can take about an hour after the funds show in the wallet.
- macOS only. Auto orders and webhook rules fill on paper only.

## 2026.11.0-beta.1

The first public beta, for macOS. Install it with
`curl -fsSL https://agent.binference.io/install.sh | sh -s -- --beta`.

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
