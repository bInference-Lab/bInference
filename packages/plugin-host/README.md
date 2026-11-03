# @binference/plugin-host

## Purpose

Runs each community plugin in a Node process of its own under Node's permission model, speaks to
it over its standard input and output, fetches for it only from the hosts it declares, starts it
again after a crash, and proves on each machine, before any plugin runs, that the sandbox refuses
what it must.

## API

| Export                  | What it does                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| `createPluginHost`      | The host: the sandbox check, then each plugin under its supervisor.      |
| `checkSandbox`          | Runs the probe plugin and a decoy, and answers the first act that held.  |
| `createDirectStarter`   | Starts plugins under the engine's own OS user.                           |
| `createLauncherStarter` | Asks the image's plugin launcher to start a plugin by its id.            |
| `pluginNodeArguments`   | The Node arguments every plugin's process starts with.                   |
| `startDebugDecoy`       | A process started as the engine is, which the probe tries to signal.     |
| `serveLauncher`         | The image's plugin launcher, which starts plugins under its own OS user. |

## Example

```ts
import { createDirectStarter, createPluginHost } from "@binference/plugin-host";

const host = createPluginHost({ starter: createDirectStarter({ program, parentEnv }), ...parts });
const started = await host.start([{ manifest, folders, config }], signal);
const answer = await host.call({ plugin: "fear-index", tool: "fear_index", input: {} }, signal);
```
