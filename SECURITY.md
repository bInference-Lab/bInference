# Security policy

binference signs transactions that move money, so a security problem can cost its owners funds.
This page says how to report one and what the security model promises.

## Report a problem privately

Report it through a [GitHub security advisory](../../security/advisories/new) on this repository.
Never open a public issue, pull request or discussion about a security problem.

A useful report holds:

- what an attacker can do, and what they need first, such as access to the machine, the owner's
  Telegram account or an installed plugin;
- the binference version or commit, the operating system and the config that matters;
- the steps to reproduce it, or a proof of concept;
- what it puts at risk: funds, keys, confirmations or the owner's data.

Use test values. Never send a real private key, owner key, recovery phrase or bot token.

## The trust model

- An agent serves one owner, on the owner's own machine.
- The wallet keys live in Privy, never on the machine. The machine holds an agent key that can ask
  Privy for a signature only inside the wallet's ceiling.
- A hacked machine can sign only inside the ceiling, and only until the owner removes its agent key
  with the owner key. Inside it, the machine cannot send to an address the owner did not save, nor
  call a contract or approve a spender no enabled venue declares; through venue calls it can lose
  at most the ceiling's 24-hour caps, trading at a bad price
  ([decision 0149](docs/DECISIONS.md#d0149)).
- An agent's launch wallet, which trades on launch curves, is the one exception: its ceiling allows
  the calls launchpads declare on any launch's own contracts and approvals naming any spender, so a
  hacked machine can take all it holds. Keep in it only what curve trades need; the agent's other
  wallets cannot send to it, and you fund it from outside
  ([decisions 0217 and 0218](docs/DECISIONS.md#d0218)).
- Whoever controls the owner's Telegram account can confirm cards, so the Telegram account is a
  key.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#section-18) lists the threats and their controls.

## Rewards

There is no paid bug bounty yet.

## What comes next

A fuller policy, with severity levels, comes before version 1.0.
