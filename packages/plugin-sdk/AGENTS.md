# @binference/plugin-sdk

What plugins import: `defineVenue`, the venue types, their contract suites and each chain family's
helpers. It is published to npm.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is the public plugin API. Every export carries TSDoc, takes its names from
  [docs/GLOSSARY.md](../../docs/GLOSSARY.md), and changes only with the API version plugins state
  in their manifest. A plugin imports this package and its own declared dependencies, nothing else
  from binference.
- It holds no logic of the money path. The venue types and their schemas live in
  `@binference/chain`, the checks of what a venue builds in the engine's venue host; this package
  re-exports the types and adds `defineVenue`, which checks a declaration when the plugin loads.
- The root export is chain-neutral. A family's helpers sit behind their own subpath, such as
  `@binference/plugin-sdk/evm`, and come from that family's package.
- `@binference/plugin-sdk/testing` gives plugins the contract suites their venues pass.
