# @binference/goplus

The GoPlus risk source: keyless token security answers from GoPlus's Token Security API.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk` and zod. The package graph enforces it.
- `src/api/` is the one folder that reads GoPlus's answers. Every answer passes the zod schema in
  `token-security.schema.ts` and leaves the folder as the source's own types; nothing else holds an
  `unknown`.
- It sends no key: without an access token GoPlus answers one token per call, and the source asks
  for one. GoPlus's official Node SDK sets a module-wide token, takes no `AbortSignal` and sends
  through its own HTTP client, so the source calls the API through the `Http` port instead.
- Every code GoPlus documents (its SDK's `ErrorCode` list) and the ones seen live is a typed outcome
  or a fault that names the code; GoPlus's message text is never shown or logged.
- A finding is a code of `RiskFlagCode`. The source reports what GoPlus found and decides nothing:
  which finding blocks a trade is the engine's rule.
- Unit tests use the answers recorded in `src/testing/`, never the network.
