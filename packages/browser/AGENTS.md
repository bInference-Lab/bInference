# @binference/browser

The agent's own browser on the owner's machine (decision 0401): a Chrome-family browser driven
through Playwright, every request it makes checked first.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It implements the engine's `BrowserDriver` port; the composition root in `cli` builds it, with
  the program the platform finds or `browser.executablePath` names, and wraps it in `withIdleStop`.
- The browser always runs with its own profile in the state folder, driven over Playwright's pipe,
  never a debugging port, and never with the owner's own profile or cookies.
- Every request and socket of every tab passes `createAddressGuard` first, through the context's
  routes; a navigation is checked before it starts. A new way for a page to reach the network
  goes through the same check, or the browser blocks it, as it blocks service workers.
- Answers are cut to the protocol's `browserLimits`; Playwright's reason for a failed action is
  answered as `problem`, without its call log.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- Tests sit beside the code as `*.test.ts`. `create-browser-driver.test.ts` runs the port's
  contract on a real browser against a page it serves on the loopback, and skips on a machine
  without a Chrome-family browser; it runs on real timers, which it puts back after.
