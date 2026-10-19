# @binference/tui

## Purpose

Terminal chat: `binference chat` talks with an agent in the terminal. It prints the agent's
answers, status lines, questions, cards and the owner's notices as they come, and keeps a live
area at the bottom with the running turn, the open question's keys, the first card's time left
and keys, and the line the owner types.

## API

| Export            | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `runTerminalChat` | Runs the chat with one agent until the owner leaves or the engine goes away. |
| `ChatTerminal`    | The terminal the chat runs in: its streams, raw mode and size.               |
| `ChatClient`      | What the chat needs of the engine's client.                                  |

## Example

```ts
import { runTerminalChat } from "@binference/tui";

const how = await runTerminalChat({ client, agent, formatter, terminal, clock, signal });
```
