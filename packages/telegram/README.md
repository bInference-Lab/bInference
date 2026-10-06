# @binference/telegram

## Purpose

The Telegram channel for the owner's own BotFather bot. This part holds what the channel keeps
and checks: the owner, paired once with a single-use start code and named only by a numeric
Telegram id; updates in binference's own shape; and the screen that cuts any update holding
something that looks like a recovery phrase, a private key or an owner key to its ids, so the
secret is never stored.

## API

| Export                             | What it does                                                                |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `issueStartCode`                   | A single-use `t.me/<bot>?start=<code>` link; only the code's hash is stored |
| `startCodeHash`                    | The hash a start code is stored under, apart from console pairing codes     |
| `OwnerStore`, `ownerBindingSchema` | Which Telegram user owns the install                                        |
| `ChatUpdate`, `ChatPost`           | Updates in binference's own shape                                           |
| `@binference/telegram/testing`     | `ownerStoreContract` and `createMemoryOwnerStore`                           |

## Example

```ts
import { issueStartCode } from "@binference/telegram";

const { link, expiresAtMs } = await issueStartCode(
  { access: stores.access, clock, random, botUsername: me.username },
  { signal },
);
print(`Open ${link.reveal()} in Telegram before ${display.time(expiresAtMs)}.`);
```
