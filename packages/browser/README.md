# @binference/browser

## Purpose

The agent's own browser on the owner's machine: a Chrome-family browser driven through Playwright,
with its own profile, every request it makes checked first.

## API

| Export                | What it does                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| `createBrowserDriver` | The engine's `BrowserDriver` over a Chrome-family browser on this machine.      |
| `createAddressGuard`  | The check every request of the browser passes: binference itself, private nets. |
| `browserRouteOf`      | The browser's route from the owner's proxy setting.                             |
| `withIdleStop`        | Stops the browser after a time without a call; `browserIdleMs` is 10 minutes.   |

## Example

```ts
import { createBrowserDriver, withIdleStop, browserIdleMs } from "@binference/browser";

const driver = withIdleStop(createBrowserDriver(options), { clock, idleMs: browserIdleMs });
```
