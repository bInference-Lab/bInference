# @binference/honeypot-is

The honeypot.is risk source: keyless buy, sell and transfer simulations from honeypot.is's API.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk` and zod. The package graph enforces it.
- The folder is `honeypot-is`, after the service's domain: `honeypot` is also a risk reason the
  engine stores, and a plugin's folder name is a registry id no pure package may spell. The source's
  id stays `honeypot`, as the risk cache's table names it.
- `src/api/` is the one folder that reads honeypot.is's answers. Every answer passes the zod schema
  in `is-honeypot.schema.ts` and leaves the folder as the source's own types; nothing else holds an
  `unknown`. honeypot.is adds fields without a new version, so the schema reads loosely.
- It sends no key, as honeypot.is's docs ask until keys exist, and names the chain on every call.
  honeypot.is publishes no SDK.
- A finding is a code of `RiskFlagCode`. The source reports what honeypot.is found and decides
  nothing: which finding blocks a trade is the engine's rule. Its taxes are not reported: the
  engine measures taxes with its own simulation.
- Unit tests use the answers recorded in `src/testing/`, never the network.
