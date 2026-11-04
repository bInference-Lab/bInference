# binference

**English** · [简体中文](README.zh.md)

binference is an open-source AI agent that trades on BNB Smart Chain for its owner. It runs on your
own machine, talks to you on Telegram, in a web console and in the terminal, and asks before every
transaction. It trades only inside the limits you set, from its own wallets.

> binference is in beta. Start in paper mode, and never fund it with more than you can lose.

## Install

binference needs Node 26.1 or later.

```sh
npm install --global binference
binference --version
```

## First steps

```sh
binference init     # language, model, wallets, rescue address, Telegram bot and limits
binference start    # runs the engine in the background, in paper mode
binference chat     # talk to your agent in the terminal
```

1. `binference init` asks each question in turn and ends in paper mode: real quotes, checks and
   cards, with no funds moved.
2. `binference start` starts the engine as a background service, and `binference status` shows
   how it runs.
3. Ask your agent for a small swap in `binference chat` or on Telegram. It answers with a card
   that shows the trade, its price and its limits; confirm it, and the paper trade fills at the
   quote.
4. `binference live` switches to real funds once you trust what you see.

## Links

- Website: <https://binference.io>
- Source and docs: <https://github.com/bInference-Lab/bInference>
- Report a security issue: see `SECURITY.md` in the repository.

MIT license. Third-party notices are in `NOTICES.md`.
