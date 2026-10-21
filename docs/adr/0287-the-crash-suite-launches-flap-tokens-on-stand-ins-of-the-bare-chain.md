# 0287. The crash suite launches Flap tokens on stand-ins of the bare chain

Status: Accepted

Accepted by the tech lead on 2026-10-21.

## Context

The release test for crash safety asks that a forced stop never sends a transaction twice, across
100 runs on each OS (Y15). The crash suite kills `binference start` on a bare anvil chain with
BSC's chain id
([decision 0135](0135-the-crash-suite-kills-binference-start.md)), and live order fills already
have 13 kill points. Token launches have none. Their steps differ from a swap's:

- The first buy runs inside the create call for Flap
  ([decision 0270](0270-a-launch-s-first-buy-may-carry-no-minimum-when-it-runs-inside-the-create-call.md)),
  Genius.fun (`launchAndBuy`,
  [decision 0277](0277-genius-fun-launches-go-to-the-m4-2-stack-with-the-router-s-minimum-on-the-first-buy.md))
  and Brew ([decision 0283](0283-brew-launches-a-token-into-a-1-pool-from-the-launch-wallet.md)).
  There is no step between the create call and the first buy.
- Before its card, a Flap launch uploads its words and picture and waits for the pin
  ([decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)),
  and a launch cut short after the upload ends `upload_lost`
  ([decision 0237](0237-a-token-launch-cut-short-after-its-upload-ends-with-a-notice.md)).
- A launch against a token pair has an exact approval step before its create call.
- A launch can start from the owner's Telegram chat
  ([decision 0285](0285-the-agent-drafts-a-token-launch-and-the-owner-starts-it-in-telegram.md)).

The bare chain holds no launchpad. A launch quotes and simulates its create call, reads that the
new token's address holds no code, and its reconcile and the launch feed read the call's receipt
and logs. Public BSC nodes keep less than a minute of state
([decision 0252](0252-log-queries-go-to-48-club-s-public-node-until-the-owner-names-an-rpc.md)),
and the suite runs for hours in the nightly job.

## Decision

- **Stand-ins on the bare chain, not a fork.** The test installs, at their BSC addresses:
  - a Flap Portal whose `newTokenV6` takes the first buy's spend (the coin as the value, or the
    pair token by `transferFrom`), makes the token at the CREATE2 address of the call's salt as a
    minimal proxy of the Tax Token V3 implementation, as the launcher predicts it, pays the caller
    1,000 base units of the token for each unit spent, logs `TokenCreated`, `TokenQuoteSet`,
    `FlapTokenTaxSet` and `TokenBought`, and answers the token; every other call reverts with
    `TokenNotFound`, as before;
  - the Tax Token V3 implementation as the suite's ERC-20 with a `mint` only the Portal may call.
- **Balances in a mapping.** The suite's tokens keep each holder's units in a Solidity mapping at
  slot 0, so the simulator's balance override finds them, as it finds a real token's.
- **Flap's API and Telegram on loopback.** The test serves Flap's upload and pin status API: an
  upload answers a CID, pin reads answer states in turn, and either can be held unanswered. For a
  chat launch it serves the install's synthetic Bot API, and the engine runs an agent runtime on a
  scripted model that drafts the launch with `launch_draft`.
- **The kill points.** A launch from the CLI, against the coin: as Flap gets the upload, as it
  gets the first pin read, as the engine reads the new token's code after the pin, with the card
  open, as custody is asked to sign the create call, once it signed, and at `stored`, `relayed`,
  `sent`, `included` and `receipt` (the receipt read and stored, before finality). Against USDT:
  `stored`, `sent` and `included` of the approval, and `asked`, `stored`, `sent`, `included` and
  `receipt` of the create call. From the chat: after Start before the launch is stored, as Flap
  gets the upload, and as it gets the first pin read. 22 points, one run each by default.
- **What each run proves,** counted by the relays, anvil, the test's Privy and Flap API and the
  store, never by the engine: each step's one transaction reaches the chain and no nonce repeats or
  is skipped; nothing is uploaded again after a restart; the launch is stored once, with one card,
  one feed record and one execution once its create call landed; the owner's notices are the
  launch's own (`notice.launchStopped`, `notice.notSigned`, `notice.stepUnsent` or none).
- **Flap only.** After the build, a launch runs the same executor, wallet queue and recovery for
  every launchpad. Flap alone uploads and pins, runs its first buy unbound and launches against a
  token with an approval step, so its runs reach every kill point. The fork tests launch on
  Genius.fun and Brew.

## Consequences

- The crash evidence covers a launch's upload, pin wait, card, signature, send and reconcile
  through a hard kill, from the CLI and from Telegram.
- The stand-ins prove what the engine does with a create call, not what Flap's Portal does: its
  fees, curve and tax stay covered by the fork tests.
- `pnpm test:crash` gains 22 kill points of about 10 seconds each per run.
- A kill between a token pair's approval and its create call ends the launch `failed_onchain`
  with `step_unsent` and keeps the exact approval, as
  [decision 0109](0109-an-intent-whose-next-step-was-never-signed-ends.md) and
  [decision 0241](0241-a-failed-launch-may-keep-its-exact-approval-and-the-engine-alone-holds-the-launch-wallet-rule.md)
  say; the runs hold that.

## Alternatives

- **A fork of BSC with Flap's real Portal.** The suite would need the network, and a node prunes
  the state a run reads within a minute while a run of every point takes over an hour. Rejected.
- **Flap's real bytecode on the bare chain.** The Portal is a proxy over an implementation that
  calls its migrators, its DEX and its tax token's helpers; each would need recording and keeping
  in step. Rejected.
- **Stand-ins for Genius.fun and Brew too.** Their create calls reach the same engine path, and
  Brew's token is its own creation code run by CREATE2. Not needed for Y15; a later task can add
  them.
