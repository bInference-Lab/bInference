# 0339. The crash suite sends, stakes and bridges on stand-ins of the bare chain

Status: Accepted

Accepted by the tech lead on 2026-11-03.

## Context

The release test for crash safety asks that a forced stop during a send, a stake or a bridge never
sends a second transaction, and that each booking and delivery is recorded once (Z10). The crash
suite kills `binference start` on a bare anvil chain with BSC's chain id
([decision 0135](0135-the-crash-suite-kills-binference-start.md)), and a Flap launch runs there on
stand-in code ([decision 0287](0287-the-crash-suite-launches-flap-tokens-on-stand-ins-of-the-bare-chain.md)).

The new paths need more than code at an address:

- StakeHub and Lista answer dozens of views that a plan and a read-back make, at the block they
  name, and a landed move must log the venue's own event; their real code calls other system
  contracts.
- A bridge needs its venue's API for the quote and the deposit's status, and a fill on the
  destination chain.
- Relay takes an order only when Relay's solver signed its id, and the id names the depositor, so
  no test can make an answer the shipped bridge takes.
- Public BSC nodes keep less than a minute of state, and the suite runs for hours each night.

## Decision

- **Stand-ins beside anvil for the staking venues.** The crash chain serves stand-ins: anvil runs
  code at the venue's address, and a model of the venue, the one its plugin's own unit tests use,
  answers its views at the block a call names, from the state before each move until that move
  landed. Before a relay passes a move on to anvil, once per transaction, the model makes the move
  and readies the code: StakeHub's scripted code logs the model's event and pays a claim's coin,
  and Lista's stake manager mints slisBNB a unit per wei through slisBNB's own code.
- **Assembled code for the bridges' contracts,** Across's SpokePool and Relay's depository, which
  pull the deposit and log the event each venue's own contract logs. The bridges' APIs answer on
  loopback: Across's recorded quote and Relay's, each made out for the run's wallet and recipient,
  and a deposit status that lands the venue's fill on a recorded Base once the deposit is mined.
- **A Relay solver only the crash engine names.** The Relay bridge takes its solver from its
  options. The composition root names Relay's solver; only the crash suite's engine sets the host
  field `testRelaySolver`, a key the rig holds, which the crash suite's Relay answers sign with.
  The entry file sets none, and no config key or variable names one; a guard test holds that the
  shipped composition counts a Relay fill only from Relay's own solver.
- **The owner's own path.** The agent's limits name the venue as a `limit set` leaves them once its
  24 hours passed; the owner adds Across with `ceiling set`, makes the Relay bridge wallet with
  `wallet create --bridge`, and saves the recipient for Base with `address add`.
- **The kill points.** A send and an approval revoke at `signed`, `stored`, `sent` and `included`.
  A stake, an unstake and a claim with StakeHub and a stake with Lista at those and at `receipt`.
  An Across bridge from the main wallet and a Relay bridge from the bridge wallet at those five on
  their deposit, and as the engine first reads the delivery. A paper webhook rule's fill once it
  stored its intent, before its write. 47 points in six files.
- **Seven nightly parts on each OS,** amending
  [decision 0290](0290-the-nightly-crash-suite-runs-in-four-parts-on-each-os.md): the swaps, sends,
  webhook fills and chat launches; the live fills; the coin launches; the token pair launches;
  the stakes; the Across bridges; and the Relay bridges. Each stays under 120 minutes at 20 runs a
  point.
- **CEX orders wait** for their own task: their kill points would hold the exchange's API, as a
  bridge's delivery point holds its venue's status.

## Consequences

- The crash evidence covers each move's plan, signature, send, recovery and booking, and a
  bridge's delivery read, through a hard kill.
- The stand-ins prove what the engine does with a venue, not what the venue does; the fork tests
  cover that.
- A bridge run waits for the engine's 30-second delivery read, so it takes about 40 seconds, and
  a run killed at that read about 67.
- `binference start` gains a host field that the shipped entry file never sets, as `testOrders`
  is for live fills ([decision 0210](0210-a-live-order-fill-signs-under-its-order-s-grant-and-counts-once-it-settles.md)).

## Alternatives

- **A BSC fork.** Fresh wallets read state a public node prunes within a minute. Rejected.
- **Recorded real state of StakeHub and Lista loaded into anvil.** Their code calls other system
  contracts; the recording would be large and need the network to refresh. Rejected.
- **Full bytecode stand-ins of StakeHub and Lista.** Each has about twenty views to assemble by
  hand. Rejected.
- **Relay answers recorded with Relay's own signature.** The order id names the depositor, and a
  run's wallet is made fresh each run. Rejected.
