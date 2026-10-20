# @binference/geniusfun

The Genius.fun launchpad: quotes, buys and sells of tokens on Genius.fun's bonding curves, one curve
per launch, and launches of tokens with their first buy.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- The factory of each live stack comes only from the registry: the venue declares them by name,
  newest first. Each launch has its own curve, which no registry lists: the venue declares it as the
  launch contract `curve` (decision 0212) and trusts a curve only as a listed stack's factory names
  it (`getLaunchedToken`), never as the token's own views say.
- `src/contracts/` is the one folder that knows Genius.fun's ABIs and reads them. A read that
  reverts or answers outside its shape throws, so a token whose place is in doubt never counts as
  off its curve. Only `launchFactory()` on a token, a view most tokens lack, may fail quietly.
- A token a stack the registry does not list says it launched is held on a curve with no contract:
  its quotes answer `no_route` (`unknown_stack`), and it goes to the pools only once that stack
  says its pool exists or it was rescued.
- The venue quotes only a token on its curve against the coin, USDT or USDC, with that asset. A
  token whose curve trades against another asset, a graduated token, one whose curve is ready to
  graduate, and a buy that would take the curve's last tokens are `no_route`, each with its reason
  (`QuoteMiss`). A launch whose curve is ready to graduate, or swept, stays held with no contract
  until its pool exists (decision 0179): its trades go nowhere, never to pools anyone else made.
  Only a launch with its pool, or one the stack's owner rescued, lets the token go to the pools.
- Quotes are the curve's own arithmetic to the wei: the fee, the creator tax and the snipe tax off
  a buy's input, each rounded down, the fee and the creator tax off a sale's proceeds. A quote names
  the creator tax and the snipe tax as its tax, and the snipe tax apart (decision 0213). The curve
  math's property test holds it to the verified source; the fork tests to the curve's own calls.
- The trade calls are the curve's `buy` and `sell`. Each pays the `recipient` it names, which is
  the wallet, and takes no deadline, so each chain declares `noDeadline` (decision 0180). A token
  input, a sale's token or a buy's USDT or USDC, gets an exact approval of the curve first.
- The decoder reads a call's terms from its bytes and its assets from the launch the venue read
  for that curve on its stack's factory when it quoted or built; a call to a curve it never read is
  `unknown_call`.
- The price read is the curve's `getReserves()` and `sellableTokens()`: the quote reserve over the
  token reserve, and `replan` once the curve sells no more tokens.
- Insiders are the wallets a launch exempted from its snipe tax, read from the curve's
  `SnipeTaxExempted` logs in the receipts of the blocks of its launch second, since public nodes
  serve no log queries. What a launch read never changes, so the venue keeps it, 512 launches at
  most, the oldest dropped first.
- The launch reading (decision 0254) reads a listed factory's `TokenLaunched` as a launch, the
  `SnipeTaxExempted` logs of the curve it names in the same transaction as insiders, and a listed
  factory's `LaunchSwept` or `PoolGraduated` as a graduation. The curve's creator tax, starting
  snipe tax, progress and `graduated()` and the token's words complete it through read calls the
  feed asks at the latest block; a read that fails leaves its fact out.
- The launcher (decisions 0275 to 0277) lives in `src/create/`. It launches on the m4.2 stack
  alone: with a first buy through the router's `launchAndBuy`, which binds the buy to its
  minimum, without one through the factory's `launchToken`. Genius.fun has no metadata API: the
  create call carries the words and the owner's `pictureLink`, so the launcher uploads nothing,
  has no pin, reads no picture and never opens the link. Both create calls are a launch wallet's
  alone (`isLaunchWalletOnly`).
- A create call is the venue's only when it would write the same bytes for what it reads: launch
  configuration 0, no creator tax, the buyback on, no Discord or Farcaster link, never
  `toFoundation`, and no snipe tax exemptions. The token comes from the dry run of the build that
  made the call, which the venue keeps for its decoder; a call it never built is `unknown_call`.
- Unit tests use the answers recorded in `src/testing/`, never the network. The fork tests in
  `src/fork/` trade live curve tokens, launch tokens of their own, and run in the fork suite.
